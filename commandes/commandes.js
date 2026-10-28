/*
 * Chicken Amine: the staff order screen (demo). Each restaurant signs in with its own account (Supabase Auth);
 * the database only shows it its own orders (see supabase/schema.sql). New orders arrive live (Realtime), with
 * a check every 20 s in case the live connection drops; each one rings and fills the screen until it is
 * accepted (with a time) or refused (with a reason the customer sees).
 */
(function () {
  const C = window.CONFIG;
  const O = C.orders;
  const POLL_MS = 20000;
  const RING_EVERY_MS = 2600;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (o) => o.id.slice(0, 4).toUpperCase();
  const time = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: C.timeZone });
  const money = (n) => `${n} DH`;
  const minutesSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60e3);

  const db = window.supabase.createClient(O.supabaseUrl, O.publishableKey);
  let site = null;          // the restaurant of the signed-in account
  let orders = new Map();   // id → order (last 24 hours)
  let alertId = null;       // the order shown in the alert
  let channel = null, pollTimer = null, ringTimer = null, audio = null, wakeLock = null;

  function show(view) {
    ["login", "start", "app"].forEach((v) => { $("#" + v).hidden = v !== view; });
  }

  /* ---------- Sign-in ---------- */
  async function signIn(e) {
    e.preventDefault();
    const f = $("#login-form");
    const err = $("#login-error");
    err.textContent = "";
    $("#login-btn").disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.password.value });
    $("#login-btn").disabled = false;
    if (error) { err.textContent = "E-mail ou mot de passe incorrect."; return; }
    afterSignIn();
  }

  async function afterSignIn() {
    const { data, error } = await db.from("staff").select("location").maybeSingle();
    site = data && C.locations.find((l) => l.id === data.location);
    if (error || !site) {
      await db.auth.signOut();
      show("login");
      $("#login-error").textContent = error ? "Connexion impossible, réessayez." : "Ce compte n'est lié à aucun restaurant.";
      return;
    }
    $("#start-place").textContent = site.name.fr;
    $("#place").textContent = site.name.fr;
    show("start");
  }

  async function signOut() {
    await db.auth.signOut();
    location.reload();
  }

  /* ---------- Service: sound, screen awake, live orders ---------- */
  async function startService() {
    unlockAudio();
    beep();
    keepAwake();
    show("app");
    tick();
    setInterval(tick, 15000);
    await load();
    subscribe();
    pollTimer = setInterval(load, POLL_MS);
  }

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === "suspended") audio.resume();
  }
  // Two rising tones, loud and short, like a kitchen bell.
  function beep() {
    if (!audio) return;
    const now = audio.currentTime;
    [[880, 0], [1175, 0.18], [880, 0.5], [1175, 0.68]].forEach(([f, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.35, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.18);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  function startRinging() {
    if (ringTimer) return;
    beep();
    ringTimer = setInterval(beep, RING_EVERY_MS);
  }
  function stopRinging() { clearInterval(ringTimer); ringTimer = null; }

  async function keepAwake() {
    try { if (navigator.wakeLock && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { /* not supported */ }
  }

  async function load() {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data, error } = await db.from("orders").select("*")
      .eq("location", site.id).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(200);
    setOnline(!error);
    if (error) return;
    orders = new Map(data.map((o) => [o.id, o]));
    render();
  }

  function subscribe() {
    channel = db.channel("orders-" + site.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `location=eq.${site.id}` }, (p) => {
        if (p.eventType === "DELETE") orders.delete(p.old.id);
        else orders.set(p.new.id, p.new);
        render();
      })
      .subscribe((status) => {
        const dot = $("#live-dot");
        dot.classList.toggle("is-live", status === "SUBSCRIBED");
        dot.classList.toggle("is-off", status !== "SUBSCRIBED");
        dot.title = status === "SUBSCRIBED" ? "En direct" : "Hors ligne (vérification toutes les 20 s)";
        // back online: catch up on what was missed
        if (status === "SUBSCRIBED") load();
      });
  }

  function setOnline(ok) { $("#offline").hidden = ok && navigator.onLine; }

  function tick() {
    $("#clock").textContent = time(new Date().toISOString());
    if (orders.size) render();
  }

  /* ---------- Updating an order ---------- */
  async function update(id, changes) {
    const { data, error } = await db.from("orders").update(changes).eq("id", id).select().maybeSingle();
    if (error || !data) return false;
    orders.set(id, data);
    render();
    return true;
  }

  async function accept(eta) {
    const id = alertId;
    $$("#alert button").forEach((b) => { b.disabled = true; });
    const ok = await update(id, { status: "accepted", eta_minutes: eta });
    $$("#alert button").forEach((b) => { b.disabled = false; });
    $("#alert-error").textContent = ok ? "" : "Échec de l'envoi. Vérifiez la connexion et réessayez.";
  }
  async function refuse(reason) {
    const id = alertId;
    $$("#alert button").forEach((b) => { b.disabled = true; });
    const ok = await update(id, { status: "refused", refuse_reason: reason || null });
    $$("#alert button").forEach((b) => { b.disabled = false; });
    $("#alert-error").textContent = ok ? "" : "Échec de l'envoi. Vérifiez la connexion et réessayez.";
  }

  async function clearTests() {
    if (!confirm(`Effacer toutes les commandes de test de ${site.name.fr} ?`)) return;
    const { error } = await db.from("orders").delete().eq("location", site.id).eq("demo", true);
    if (error) { alert("Échec. Vérifiez la connexion et réessayez."); return; }
    await load();
  }

  /* ---------- Display ---------- */
  function itemsHtml(o) {
    return `<ul class="items">${(o.items || []).map((l) =>
      `<li><b>${esc(l.qty)} ×</b> ${esc(l.name)}${l.size ? ` (${esc(l.size)})` : ""}${(l.details || []).map((d) => `<small>${esc(d)}</small>`).join("")}</li>`).join("")}</ul>`;
  }

  function detailsHtml(o) {
    const delivery = o.mode === "delivery";
    const map = o.lat != null ? `https://maps.google.com/?q=${o.lat},${o.lng}` : "";
    return `<p class="order__meta"><span class="tag${delivery ? " tag--delivery" : ""}">${delivery ? "Livraison" : "À emporter"}</span>
        ${o.demo ? '<span class="tag tag--demo">test</span>' : ""}<br>
        <strong>${esc(o.customer_name)}</strong> · <a href="tel:${esc(o.customer_phone.replace(/[^\d+]/g, ""))}">${esc(o.customer_phone)}</a></p>
      ${itemsHtml(o)}
      ${o.notes ? `<p class="order__notes">Note : ${esc(o.notes)}</p>` : ""}
      ${delivery ? `<p class="order__addr">${o.address ? esc(o.address) + "<br>" : ""}${map ? `<a href="${map}" target="_blank" rel="noopener">Voir sur la carte</a>` : ""}${o.distance_km != null ? ` · ${String(o.distance_km).replace(".", ",")} km` : ""}</p>` : ""}
      <p class="order__total"><span>Total${o.delivery_fee ? ` (livraison ${money(o.delivery_fee)})` : ""}</span><span>${money(o.total)}</span></p>`;
  }

  function statusLine(o) {
    if (o.status === "new") return { text: `En attente de réponse depuis ${minutesSince(o.created_at)} min`, late: minutesSince(o.created_at) >= (O.callAfterMinutes || 5) };
    if (o.status === "accepted") {
      const left = o.eta_minutes - minutesSince(o.accepted_at || o.updated_at);
      return left >= 0 ? { text: `Prête dans ${left} min (promis : ${o.eta_minutes} min)` } : { text: `En retard de ${-left} min`, late: true };
    }
    if (o.status === "ready") return { text: o.mode === "delivery" ? "Prête · en attente du livreur" : "Prête · le client peut venir" };
    if (o.status === "on_the_way") return { text: "En route" };
    if (o.status === "refused") return { text: `Refusée${o.refuse_reason ? " : " + o.refuse_reason : ""}` };
    return { text: "Terminée" };
  }

  function actionsHtml(o) {
    const b = (status, label, cls) => `<button class="btn ${cls}" type="button" data-id="${o.id}" data-status="${status}">${label}</button>`;
    if (o.status === "new") return `<button class="btn btn--red" type="button" data-answer="${o.id}">Répondre</button>`;
    if (o.status === "accepted") return b("ready", "Prête", "btn--green");
    if (o.status === "ready") return o.mode === "delivery" ? b("on_the_way", "En route", "btn--yellow") : b("done", "Récupérée", "btn--green");
    if (o.status === "on_the_way") return b("done", "Livrée", "btn--green");
    return "";
  }

  function cardHtml(o) {
    const st = statusLine(o);
    const actions = actionsHtml(o);
    return `<li class="order order--${o.status}">
      <div class="order__head"><span class="order__num">N° ${num(o)}</span><span class="order__time">${time(o.created_at)}</span></div>
      ${detailsHtml(o)}
      <p class="order__status${st.late ? " is-late" : ""}">${esc(st.text)}</p>
      ${actions ? `<div class="order__actions">${actions}</div>` : ""}
    </li>`;
  }

  function fill(id, list, emptyText) {
    $("#" + id).innerHTML = list.length ? list.map(cardHtml).join("") : `<li class="empty">${emptyText}</li>`;
  }

  function render() {
    const all = Array.from(orders.values());
    const byOld = (a, b) => new Date(a.created_at) - new Date(b.created_at);
    const pending = all.filter((o) => o.status === "new").sort(byOld);
    const cooking = all.filter((o) => o.status === "accepted").sort(byOld);
    const ready = all.filter((o) => o.status === "ready" || o.status === "on_the_way").sort(byOld);
    const past = all.filter((o) => o.status === "done" || o.status === "refused").sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 30);
    fill("col-new", pending, "Aucune commande en attente.");
    fill("col-accepted", cooking, "Rien en préparation.");
    fill("col-ready", ready, "Rien à remettre.");
    fill("col-past", past, "Aucune pour l'instant.");
    $("#n-new").textContent = pending.length;
    $("#n-accepted").textContent = cooking.length;
    $("#n-ready").textContent = ready.length;
    $("#n-past").textContent = past.length;

    const kept = all.filter((o) => o.status !== "refused" && o.status !== "new");
    const stats = [
      [all.length, "commandes (24 h)"],
      [money(kept.reduce((s, o) => s + o.total, 0)), "chiffre des commandes acceptées"],
      [cooking.length + ready.length, "en cours"],
      [all.filter((o) => o.status === "refused").length, "refusées"],
    ];
    $("#summary").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

    document.title = pending.length ? `(${pending.length}) Nouvelle commande · Chicken Amine` : "Chicken Amine · Commandes";
    renderAlert(pending);
  }

  function renderAlert(pending) {
    // the order shown stays until it is answered (here or on another screen); then the next oldest
    if (!pending.some((o) => o.id === alertId)) alertId = pending.length ? pending[0].id : null;
    const box = $("#alert");
    if (!alertId) { box.hidden = true; stopRinging(); return; }
    const o = orders.get(alertId);
    const first = box.hidden || box.dataset.id !== alertId;
    box.hidden = false;
    if (first) {
      box.dataset.id = alertId;
      $("#alert-title").textContent = `N° ${num(o)} · ${time(o.created_at)}`;
      $("#alert-order").innerHTML = detailsHtml(o);
      $("#alert-main").hidden = false;
      $("#alert-reasons").hidden = true;
      $("#alert-error").textContent = "";
    }
    const more = pending.length - 1;
    $("#alert-more").textContent = more > 0 ? `(+ ${more} en attente)` : "";
    startRinging();
  }

  /* ---------- Events ---------- */
  function bind() {
    $("#login-form").addEventListener("submit", signIn);
    $("#start-btn").addEventListener("click", startService);
    $("#start-logout").addEventListener("click", signOut);
    $("#logout-btn").addEventListener("click", signOut);
    $("#sound-btn").addEventListener("click", () => { unlockAudio(); beep(); });
    $("#clear-btn").addEventListener("click", clearTests);
    $("#alert-times").addEventListener("click", (e) => { const b = e.target.closest("[data-eta]"); if (b) accept(Number(b.dataset.eta)); });
    $("#alert-refuse").addEventListener("click", () => { $("#alert-main").hidden = true; $("#alert-reasons").hidden = false; });
    $("#alert-back").addEventListener("click", () => { $("#alert-main").hidden = false; $("#alert-reasons").hidden = true; });
    $("#alert-reasons").addEventListener("click", (e) => { const b = e.target.closest("[data-reason]"); if (b) refuse(b.dataset.reason); });
    $(".board").addEventListener("click", async (e) => {
      const ans = e.target.closest("[data-answer]");
      if (ans) { alertId = ans.dataset.answer; $("#alert").dataset.id = ""; render(); return; }
      const b = e.target.closest("[data-status]");
      if (!b) return;
      b.disabled = true;
      if (!(await update(b.dataset.id, { status: b.dataset.status }))) { b.disabled = false; alert("Échec. Vérifiez la connexion et réessayez."); }
    });
    addEventListener("online", () => { setOnline(true); if (site && !$("#app").hidden) load(); });
    addEventListener("offline", () => setOnline(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !site || $("#app").hidden) return;
      keepAwake();
      unlockAudio();
      load();
    });
  }

  bind();
  db.auth.getSession().then(({ data }) => { if (data.session) afterSignIn(); else show("login"); });
})();
