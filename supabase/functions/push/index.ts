// Chicken Amine: push notifications to the staff phones (Supabase Edge Function "push").
// Called by the database (supabase/schema.sql): at once when an order arrives, then every 30 s while orders wait.
// Each waiting order rings its restaurant's phones, then again about once a minute, for 10 minutes at most.
// A signed-in staff account can also ask for a test notification on its own phones (« Envoyer une notification
// test » in the staff app). Every answer of the push services is written to push_log.
import { createClient } from "jsr:@supabase/supabase-js@2.49.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const AGAIN_AFTER_MS = 55_000;
const MAX_RINGS = 11;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

type Sub = { endpoint: string; p256dh: string; auth: string; user_id: string; device: string | null };

// Sends one notification and records the answer; a phone that no longer exists (404/410) is forgotten.
async function send(s: Sub, payload: string, kind: string) {
  let status = 0, detail = "";
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 120, urgency: "high" });
    status = r.statusCode;
  } catch (e) {
    status = e?.statusCode ?? -1;
    detail = String(e?.body ?? e?.message ?? e).slice(0, 300);
    if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
  }
  await db.from("push_log").insert({ user_id: s.user_id, device: s.device, endpoint: s.endpoint.slice(0, 120), status, detail, kind });
  return status;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: cfg } = await db.from("push_config").select("*").eq("id", 1).single();
  if (!cfg) return json({ error: "not configured" }, 500);
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  const body = await req.json().catch(() => ({}));

  // A staff account tests its own phones.
  if (body.mode === "test") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "sign in first" }, 401);
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", who.user.id);
    const payload = JSON.stringify({ title: "🔔 Test · Chicken Amine", body: "Les notifications fonctionnent sur ce téléphone.", tag: "test", url: "/commandes/" });
    const results = [];
    for (const s of subs ?? []) results.push(await send(s, payload, "test"));
    return json({ phones: results.length, results });
  }

  if (req.headers.get("x-push-secret") !== cfg.call_secret) return json({ error: "forbidden" }, 403);

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: waiting } = await db.from("orders").select("id, location, mode, total, items, created_at").eq("status", "new").gte("created_at", since);
  if (!waiting?.length) return json({ sent: 0 });
  const { data: sent } = await db.from("push_sent").select("*").in("order_id", waiting.map((o) => o.id));
  const sentBy = new Map((sent ?? []).map((s) => [s.order_id, s]));
  const due = waiting.filter((o) => {
    const s = sentBy.get(o.id);
    return !s || (s.count < MAX_RINGS && Date.now() - new Date(s.last_at).getTime() > AGAIN_AFTER_MS);
  });
  if (!due.length) return json({ sent: 0 });

  // the restaurant accounts (not the owner's) and their phones
  const { data: staff } = await db.from("staff").select("user_id, location").eq("role", "staff");
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", (staff ?? []).map((s) => s.user_id));
  const locationOf = new Map((staff ?? []).map((s) => [s.user_id, s.location]));

  let count = 0;
  for (const o of due) {
    const n = (sentBy.get(o.id)?.count ?? 0) + 1;
    const dishes = (o.items ?? []).reduce((t: number, l: { qty: number }) => t + l.qty, 0);
    const payload = JSON.stringify({
      title: `${n > 1 ? "⏰ Toujours en attente · " : "🔔 Nouvelle commande · "}N° ${o.id.slice(0, 4).toUpperCase()}`,
      body: `${o.mode === "delivery" ? "Livraison" : "À emporter"} · ${dishes} article${dishes > 1 ? "s" : ""} · ${o.total} DH`,
      tag: o.id,
      url: "/commandes/",
    });
    for (const s of (subs ?? []).filter((x) => locationOf.get(x.user_id) === o.location)) {
      const status = await send(s, payload, n > 1 ? "reminder" : "order");
      if (status >= 200 && status < 300) count++;
    }
    await db.from("push_sent").upsert({ order_id: o.id, count: n, last_at: new Date().toISOString() });
  }
  return json({ sent: count, orders: due.length });
});
