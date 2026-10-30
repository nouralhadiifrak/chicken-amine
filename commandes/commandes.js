/*
 * Chicken Amine: the staff order screen, installable as its own app. Each restaurant signs in with its own
 * account (Supabase Auth) and the database only shows it its own orders; the owner's account sees both
 * restaurants (see supabase/schema.sql). New orders arrive live (Realtime), with a check every 20 s in case the
 * live connection drops; each one rings and fills the screen until it is accepted (with a time) or refused
 * (with a reason the customer sees); the staff can also cancel an accepted order, with a reason. Phones that
 * turn notifications on are rung even when locked (push, sent by supabase/functions/push). The « Statistiques »
 * tab adds up what was collected and what sold most. The owner follows the orders and the statistics, without
 * the pop-up, the sound or the buttons.
 */
(function () {
  const C = window.CONFIG;
  const O = C.orders;
  const POLL_MS = 20000;
  const FULL_RELOAD_MS = 10 * 60e3;
  const RING_EVERY_MS = 2600;
  // The restaurants close at 01:00: a service day runs from 06:00 to 06:00, Casablanca time.
  const DAY_START_HOUR = 6;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (o) => o.id.slice(0, 4).toUpperCase();
  const time = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: C.timeZone });
  const money = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} DH`;
  const minutesSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60e3);
  const siteById = (id) => C.locations.find((l) => l.id === id);

  const db = window.supabase.createClient(O.supabaseUrl, O.publishableKey);
  let site = null;          // the restaurant of the signed-in account (null for the owner)
  let owner = false;        // the owner's account sees both restaurants
  let orders = new Map();   // id → order (last 24 hours)
  let lastSync = null, lastFull = 0;
  let alertId = null;       // the order shown in the alert
  let channel = null, pollTimer = null, ringTimer = null, audio = null, wakeLock = null, installPrompt = null;
  let statsPeriod = "today", statsSite = "all";
  // Receipt printer: ready but switched off until the restaurant has its printer (then set PRINTING to true).
  // It is set on the device the printer is connected to (off, 80 mm or 58 mm paper), kept in this browser.
  const PRINTING = false;
  const PRINT_KEY = "chickenamine.print.v1";
  const PRINTED_KEY = "chickenamine.printed.v1";
  let printMode = readStore(PRINT_KEY) || "off";
  const printed = new Set(JSON.parse(readStore(PRINTED_KEY) || "[]"));
  function readStore(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  function show(view) {
    ["login", "start", "app"].forEach((v) => { $("#" + v).hidden = v !== view; });
  }
  // Only the account's own restaurant, unless it is the owner's.
  const scoped = (q) => (owner ? q : q.eq("location", site.id));
  const placeName = () => (owner ? "Chicken Amine · les deux restaurants" : site.name.fr);

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
    const { data, error } = await db.from("staff").select("location, role").maybeSingle();
    owner = !!data && data.role === "owner";
    site = data && siteById(data.location);
    if (error || !(owner || site)) {
      await db.auth.signOut();
      show("login");
      $("#login-error").textContent = error ? "Connexion impossible, réessayez." : "Ce compte n'est lié à aucun restaurant.";
      return;
    }
    $("#start-place").textContent = placeName();
    $("#place").textContent = placeName();
    $("#stats-sites").hidden = !owner;
    document.body.classList.toggle("is-owner", owner);
    // the owner does not answer orders: no sound to unlock, straight to the statistics
    if (owner) { startService(); showTab("stats"); return; }
    show("start");
  }

  async function signOut() {
    await db.auth.signOut();
    location.reload();
  }

  /* ---------- Service: sound, screen awake, live orders ---------- */
  async function startService() {
    if (!owner) { unlockAudio(); beep(); }
    keepAwake();
    show("app");
    renderInstall();
    refreshNotifications();
    tick();
    setInterval(tick, 15000);
    await load();
    subscribe();
    pollTimer = setInterval(poll, POLL_MS);
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

  function remember(list) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    list.forEach((o) => {
      // only the last 24 hours (the clean-up that empties older orders also comes in as a change)
      if (o.created_at < since) { orders.delete(o.id); return; }
      orders.set(o.id, o);
      if (!lastSync || o.updated_at > lastSync) lastSync = o.updated_at;
      autoPrint(o);
    });
  }
  // Every order of the last 24 hours (also drops the ones cleared on another screen).
  async function load() {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const { data, error } = await scoped(db.from("orders").select("*"))
      .gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    setOnline(!error);
    if (error) return;
    orders = new Map();
    lastSync = null;
    remember(data);
    lastFull = Date.now();
    render();
  }
  // In between, only what changed since the last check: a few bytes instead of the whole list.
  async function poll() {
    if (!lastSync || Date.now() - lastFull > FULL_RELOAD_MS) return load();
    const { data, error } = await scoped(db.from("orders").select("*")).gte("updated_at", lastSync).limit(300);
    setOnline(!error);
    if (error || !data.length) return;
    remember(data);
    render();
  }

  function subscribe() {
    const opts = { event: "*", schema: "public", table: "orders" };
    if (!owner) opts.filter = `location=eq.${site.id}`;
    channel = db.channel("orders-" + (owner ? "all" : site.id))
      .on("postgres_changes", opts, (p) => {
        if (p.eventType === "DELETE") orders.delete(p.old.id);
        else remember([p.new]);
        render();
      })
      .subscribe((status) => {
        const dot = $("#live-dot");
        dot.classList.toggle("is-live", status === "SUBSCRIBED");
        dot.classList.toggle("is-off", status !== "SUBSCRIBED");
        dot.title = status === "SUBSCRIBED" ? "En direct" : "Hors ligne (vérification toutes les 20 s)";
        // back online: catch up on what was missed
        if (status === "SUBSCRIBED") poll();
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
    remember([data]);
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

  // The staff cancel an order already accepted (any time before it is finished), with a reason.
  let cancelId = null;
  function askCancel(id) {
    cancelId = id;
    $("#cancel-title").textContent = `Annuler la commande N° ${num(orders.get(id))}`;
    $("#cancel-error").textContent = "";
    $("#cancel-box").hidden = false;
  }
  async function cancel(reason) {
    $$("#cancel-box button").forEach((b) => { b.disabled = true; });
    const ok = await update(cancelId, { status: "cancelled", cancelled_by: "staff", cancel_reason: reason || null });
    $$("#cancel-box button").forEach((b) => { b.disabled = false; });
    if (ok) $("#cancel-box").hidden = true;
    else $("#cancel-error").textContent = "Échec. Vérifiez la connexion et réessayez.";
  }

  async function clearTests() {
    if (!confirm(`Effacer toutes les commandes de test de ${placeName()} ?`)) return;
    const { error } = await scoped(db.from("orders").delete()).eq("demo", true);
    if (error) { alert("Échec. Vérifiez la connexion et réessayez."); return; }
    await load();
  }

  /* ---------- Receipts: printed when the order is accepted (here or on another screen) ---------- */
  function autoPrint(o) {
    if (!PRINTING || printMode === "off" || o.status !== "accepted" || printed.has(o.id) || !o.accepted_at) return;
    // not the orders accepted long ago (when the screen is opened again later)
    if (minutesSince(o.accepted_at) > 10) return;
    printOrder(o);
  }
  function receiptHtml(o, width) {
    const s = siteById(o.location);
    const delivery = o.mode === "delivery";
    const readyAt = o.accepted_at && o.eta_minutes ? time(new Date(new Date(o.accepted_at).getTime() + o.eta_minutes * 60e3).toISOString()) : "";
    const date = new Date(o.created_at).toLocaleDateString("fr-FR", { timeZone: C.timeZone });
    const line = (a, b, cls) => `<div class="row${cls ? " " + cls : ""}"><span>${a}</span><span>${b}</span></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>N° ${num(o)}</title><style>
      @page { size: ${width}mm auto; margin: 0; }
      * { box-sizing: border-box; }
      /* sized on the page's width (vw), so the receipt fills the paper whatever its size */
      html, body { width: 100%; }
      body { margin: 0; padding: 4vw 4vw 8vw; font: ${width > 60 ? 4.2 : 4.8}vw/1.35 Arial, sans-serif; color: #000; }
      h1 { font-size: 1.5em; text-align: center; margin: 0; } .c { text-align: center; } .big { font-size: 1.9em; font-weight: 700; text-align: center; margin: 2mm 0; }
      hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; } .row { display: flex; justify-content: space-between; gap: 2mm; }
      .det { padding-left: 5mm; font-size: 0.9em; } .tot { font-size: 1.3em; font-weight: 700; } .mode { font-size: 1.3em; font-weight: 700; text-align: center; border: 2px solid #000; padding: 1mm; }
      .note { border: 1px solid #000; padding: 1mm 2mm; font-weight: 700; margin-top: 2mm; }
    </style></head><body>
      <h1>CHICKEN AMINE</h1><div class="c">${esc(s.name.fr)}<br>${esc(s.phone.replace(/(\d{2})(?=\d)/g, "$1 "))}</div><hr>
      <div class="big">N° ${num(o)}</div><div class="c">${date} · ${time(o.created_at)}${readyAt ? ` · prête vers ${readyAt}` : ""}</div>
      <div class="mode">${delivery ? "LIVRAISON" : "À EMPORTER"}</div><hr>
      <div><b>${esc(o.customer_name)}</b> · ${esc(o.customer_phone)}</div>
      ${delivery && o.address ? `<div>${esc(o.address)}</div>` : ""}${delivery && o.distance_km != null ? `<div>${String(o.distance_km).replace(".", ",")} km</div>` : ""}<hr>
      ${(o.items || []).map((l) => line(`<b>${esc(l.qty)} ×</b> ${esc(l.name)}${l.size ? ` (${esc(l.size)})` : ""}`, money(l.total || 0)) + (l.details || []).map((d) => `<div class="det">${esc(d)}</div>`).join("")).join("")}
      ${o.notes ? `<div class="note">Note : ${esc(o.notes)}</div>` : ""}<hr>
      ${line("Sous-total", money(o.subtotal))}${o.delivery_fee ? line("Livraison", money(o.delivery_fee)) : ""}${line("TOTAL", money(o.total), "tot")}
      <hr><div class="c">Merci et bon appétit !<br>chickenamine.ma</div>
    </body></html>`;
  }
  // Prints through the browser: silently on a computer whose Chrome runs in kiosk-printing mode (see README),
  // otherwise the print window opens on its own and one tap prints.
  function printOrder(o) {
    printed.add(o.id);
    writeStore(PRINTED_KEY, JSON.stringify(Array.from(printed).slice(-200)));
    const frame = document.createElement("iframe");
    frame.className = "print-frame";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(receiptHtml(o, printMode === "58" ? 58 : 80));
    doc.close();
    window.__receipts = (window.__receipts || 0) + 1;
    setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { /* printing unavailable */ }
      setTimeout(() => frame.remove(), 60000);
    }, 250);
  }
  const PRINT_LABEL = { off: "🖨 Impression auto : non", 80: "🖨 Impression auto : 80 mm", 58: "🖨 Impression auto : 58 mm" };
  function renderPrint() {
    $("#print-btn").hidden = !PRINTING;
    $("#print-label").textContent = PRINT_LABEL[printMode].replace("🖨 ", "");
    $("#print-btn").classList.toggle("is-on", printMode !== "off");
  }
  function cyclePrint() {
    printMode = printMode === "off" ? "80" : printMode === "80" ? "58" : "off";
    writeStore(PRINT_KEY, printMode);
    renderPrint();
  }

  /* ---------- The delivery guy: the order on WhatsApp, with the customer's exact position ---------- */
  function driverMessage(o) {
    const lines = [`🛵 *Livraison N° ${num(o)}*`];
    if (owner) lines.push(`Restaurant : ${siteById(o.location).name.fr}`);
    lines.push(`Client : ${o.customer_name} · ${o.customer_phone}`);
    if (o.address) lines.push(`Adresse : ${o.address}`);
    if (o.lat != null) lines.push(`📍 Position : https://maps.google.com/?q=${o.lat},${o.lng}`);
    if (o.distance_km != null) lines.push(`Distance : ${String(o.distance_km).replace(".", ",")} km`);
    lines.push("");
    (o.items || []).forEach((l) => lines.push(`${l.qty} × ${l.name}${l.size ? ` (${l.size})` : ""}${(l.details || []).length ? ` · ${l.details.join(", ")}` : ""}`));
    lines.push("");
    lines.push(`*À encaisser : ${money(o.total)}*${o.delivery_fee ? ` (dont livraison ${money(o.delivery_fee)})` : ""}`);
    if (o.notes) lines.push(`Note : ${o.notes}`);
    return lines.join("\n");
  }
  // No number: WhatsApp asks which contact (the delivery guy) to send it to.
  function sendToDriver(id) {
    const url = `https://wa.me/?text=${encodeURIComponent(driverMessage(orders.get(id)))}`;
    const w = window.open(url, "_blank", "noopener");
    if (!w) location.href = url;
  }

  /* ---------- Display ---------- */
  function itemsHtml(o) {
    return `<ul class="items">${(o.items || []).map((l) =>
      `<li><b>${esc(l.qty)} ×</b> ${esc(l.name)}${l.size ? ` (${esc(l.size)})` : ""}${(l.details || []).map((d) => `<small>${esc(d)}</small>`).join("")}</li>`).join("")}</ul>`;
  }

  function detailsHtml(o) {
    const delivery = o.mode === "delivery";
    const map = o.lat != null ? `https://maps.google.com/?q=${o.lat},${o.lng}` : "";
    return `<p class="order__meta">${owner ? `<span class="tag tag--site">${esc(siteById(o.location).short.fr)}</span> ` : ""}<span class="tag${delivery ? " tag--delivery" : ""}">${delivery ? "Livraison" : "À emporter"}</span>
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
    if (o.status === "cancelled") return { text: o.cancelled_by === "customer" ? "Annulée par le client" : `Annulée${o.cancel_reason ? " : " + o.cancel_reason : ""}`, late: o.cancelled_by === "customer" };
    return { text: "Terminée" };
  }

  function actionsHtml(o) {
    const b = (status, label, cls) => `<button class="btn ${cls}" type="button" data-id="${o.id}" data-status="${status}">${label}</button>`;
    const driver = o.mode === "delivery" ? `<button class="btn btn--wa" type="button" data-driver="${o.id}">Envoyer au livreur</button>` : "";
    const reprint = PRINTING ? `<button class="btn btn--line" type="button" data-print="${o.id}">🖨 Réimprimer</button>` : "";
    const cancelBtn = `<button class="btn btn--line" type="button" data-cancel="${o.id}">Annuler</button>`;
    // the owner follows, he does not answer
    if (owner) return "";
    if (o.status === "new") return `<button class="btn btn--red" type="button" data-answer="${o.id}">Répondre</button>`;
    if (o.status === "accepted") return driver + reprint + b("ready", "Prête", "btn--green") + cancelBtn;
    if (o.status === "ready") return (o.mode === "delivery" ? driver + b("on_the_way", "En route", "btn--yellow") : b("done", "Récupérée", "btn--green")) + cancelBtn;
    if (o.status === "on_the_way") return driver + b("done", "Livrée", "btn--green") + cancelBtn;
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
    const past = all.filter((o) => ["done", "refused", "cancelled"].includes(o.status)).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 30);
    fill("col-new", pending, "Aucune commande en attente.");
    fill("col-accepted", cooking, "Rien en préparation.");
    fill("col-ready", ready, "Rien à remettre.");
    fill("col-past", past, "Aucune pour l'instant.");
    $("#n-new").textContent = pending.length;
    $("#n-accepted").textContent = cooking.length;
    $("#n-ready").textContent = ready.length;
    $("#n-past").textContent = past.length;

    const kept = all.filter((o) => !["new", "refused", "cancelled"].includes(o.status));
    const stats = [
      [all.length, "commandes (24 h)"],
      [money(kept.reduce((s, o) => s + o.total, 0)), "chiffre des commandes acceptées"],
      [cooking.length + ready.length, "en cours"],
      [all.filter((o) => o.status === "refused" || o.status === "cancelled").length, "refusées ou annulées"],
    ];
    $("#summary").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

    document.title = pending.length && !owner ? `(${pending.length}) Nouvelle commande · Chicken Amine` : "Chicken Amine · Commandes";
    renderAlert(owner ? [] : pending);
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

  /* ---------- Statistics ---------- */
  // Casablanca's clock for a moment: [year, month, day, hour], and its offset from UTC in ms.
  function local(d) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, +x.value]));
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60e3) * 60e3;
    return { y: p.year, m: p.month, d: p.day, h: p.hour, offset };
  }
  // The instant a service day starts (06:00 Casablanca time), for a calendar day.
  const dayStart = (y, m, d, offset) => new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR) - offset);
  function periodRange(period) {
    const now = new Date();
    const l = local(now);
    let today = dayStart(l.y, l.m, l.d, l.offset);
    if (now < today) today = new Date(today.getTime() - 24 * 3600e3);
    const day = 24 * 3600e3;
    const tl = local(today);
    if (period === "today") return [today, now];
    if (period === "yesterday") return [new Date(today.getTime() - day), today];
    if (period === "week") return [new Date(today.getTime() - 6 * day), now];
    if (period === "month") return [dayStart(tl.y, tl.m, 1, tl.offset), now];
    // last month
    const first = dayStart(tl.y, tl.m, 1, tl.offset);
    const pm = tl.m === 1 ? [tl.y - 1, 12] : [tl.y, tl.m - 1];
    return [dayStart(pm[0], pm[1], 1, tl.offset), first];
  }

  async function loadStats() {
    const box = $("#stats-body");
    box.innerHTML = '<p class="empty">Calcul…</p>';
    const [from, to] = periodRange(statsPeriod);
    const rows = [];
    // 1000 rows per request at most: read the period in pages
    for (let page = 0; page < 20; page++) {
      let q = db.from("orders").select("location,status,mode,total,delivery_fee,items,created_at")
        .gte("created_at", from.toISOString()).lt("created_at", to.toISOString())
        .in("status", ["done", "refused", "cancelled"]).order("created_at").range(page * 1000, page * 1000 + 999);
      if (!owner) q = q.eq("location", site.id);
      else if (statsSite !== "all") q = q.eq("location", statsSite);
      const { data, error } = await q;
      if (error) { box.innerHTML = '<p class="error">Impossible de charger les statistiques. Vérifiez la connexion.</p>'; return; }
      rows.push(...data);
      if (data.length < 1000) break;
    }
    renderStats(rows);
  }

  function rankList(entries, color, withAmount) {
    if (!entries.length) return '<p class="empty">Rien pour cette période.</p>';
    const max = Math.max(...entries.map((e) => e.count));
    return `<ol class="rank">${entries.map((e, i) => `<li><span class="rank__n">${e.icon || i + 1}</span>
      <div>${esc(e.label)}<div class="bar" style="width:${Math.max(4, Math.round((100 * e.count) / max))}%;background:${e.color || color}"></div></div>
      <span class="num">${e.count}</span><span class="num">${withAmount ? money(e.amount) : ""}</span></li>`).join("")}</ol>`;
  }

  function renderStats(rows) {
    const done = rows.filter((o) => o.status === "done");
    const cashed = done.reduce((s, o) => s + o.total, 0);
    const fees = done.reduce((s, o) => s + (o.delivery_fee || 0), 0);
    const items = new Map();
    done.forEach((o) => (o.items || []).forEach((l) => {
      const key = l.name + (l.size ? ` (${l.size})` : "");
      const e = items.get(key) || { label: key, count: 0, amount: 0 };
      e.count += l.qty;
      e.amount += l.total || 0;
      items.set(key, e);
    }));
    const top = Array.from(items.values()).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 10);
    const modes = ["delivery", "pickup"].map((m) => {
      const list = done.filter((o) => o.mode === m);
      return { icon: m === "delivery" ? "🛵" : "🛍", label: m === "delivery" ? "Livraison" : "À emporter", color: m === "delivery" ? "var(--red)" : "var(--green)", count: list.length, amount: list.reduce((s, o) => s + o.total, 0) };
    }).filter((e) => e.count);
    const hours = new Map();
    done.forEach((o) => { const h = local(new Date(o.created_at)).h; hours.set(h, (hours.get(h) || 0) + 1); });
    const busy = Array.from(hours.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([h, n]) => ({ label: `${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00`, count: n }));
    const cards = [
      [money(cashed), "encaissé via l'app (commandes terminées)", true],
      [done.length, "commandes terminées"],
      [money(done.length ? cashed / done.length : 0), "panier moyen"],
      [money(fees), "frais de livraison (dont)"],
      [rows.filter((o) => o.status === "refused").length, "refusées"],
      [rows.filter((o) => o.status === "cancelled").length, "annulées"],
    ];
    $("#stats-body").innerHTML = `<section class="summary">${cards.map(([v, l, hl]) => `<div class="stat${hl ? " stat--hl" : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</section>
      <div class="panels">
        <div class="panel"><h2>Les plus vendus</h2>${rankList(top, "var(--yellow)", true)}<p class="panel__note">Quantité vendue · montant</p></div>
        <div class="panel"><h2>Répartition</h2>${rankList(modes, "var(--red)", true)}
          <h2 class="panel__h2">Heures les plus chargées</h2>${rankList(busy, "var(--black)", false)}</div>
      </div>`;
  }

  function showTab(tab) {
    $$("[data-tab]").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
    $("#tab-orders").hidden = tab !== "orders";
    $("#tab-stats").hidden = tab !== "stats";
    if (tab === "stats") loadStats();
  }

  /* ---------- The staff app: installable once signed in ---------- */
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function renderInstall() {
    const off = isStandalone() || !(installPrompt || isIos());
    $("#install-btn").hidden = off;
    $("#menu-install").hidden = off;
  }
  function install() {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      if (p.userChoice) p.userChoice.then(renderInstall, renderInstall); else renderInstall();
    } else if (isIos()) {
      alert("Pour installer l'application sur iPhone :\n1. Touchez le bouton Partager (le carré avec une flèche) dans Safari\n2. Choisissez « Sur l'écran d'accueil »\n3. Touchez « Ajouter »");
    }
  }

  /* ---------- The menu (☰) ---------- */
  function openMenu() { $("#menu").hidden = false; $("#menu-shade").hidden = false; $("#menu-btn").setAttribute("aria-expanded", "true"); }
  function closeMenu() { $("#menu").hidden = true; $("#menu-shade").hidden = true; $("#menu-btn").setAttribute("aria-expanded", "false"); }

  /* ---------- Push notifications: ring this phone even when it is locked ---------- */
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  function setNotify(state) {
    const text = {
      on: ["Notifications activées ✓", "Ce téléphone sonne même verrouillé"],
      off: ["Activer les notifications", "Pour être prévenu même téléphone verrouillé"],
      denied: ["Notifications bloquées", "Autorisez-les dans les réglages du téléphone (Chrome → Notifications)"],
      unsupported: ["Notifications indisponibles", "Installez l'application, puis réessayez"],
      error: ["Notifications : échec", "Vérifiez la connexion et réessayez"],
    }[state];
    $("#notify-label").textContent = text[0];
    $("#notify-help").textContent = text[1];
    $("#notify-btn").classList.toggle("is-on", state === "on");
  }
  function b64Bytes(b64) {
    const s = atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  async function saveSubscription(sub) {
    const j = sub.toJSON();
    const { error } = await db.from("push_subscriptions").upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 300) }, { onConflict: "endpoint" });
    return !error;
  }
  // The staff app's own service worker (scope /commandes/): on Android its notifications then belong to the staff
  // app (with the site's worker, scope /, they went to the customer app and the phone cancelled them).
  const STAFF_SW = "/commandes/sw.js";
  const STAFF_SCOPE = "/commandes/";
  async function staffWorker() {
    const reg = await navigator.serviceWorker.register(STAFF_SW, { scope: STAFF_SCOPE });
    // (never wait forever for it to start)
    await Promise.race([
      new Promise((ok) => {
        if (reg.active) return ok();
        const w = reg.installing || reg.waiting;
        if (w) w.addEventListener("statechange", () => { if (w.state === "activated") ok(); });
        else ok();
      }),
      new Promise((_, no) => setTimeout(no, 10000)),
    ]);
    return reg;
  }
  async function enableNotifications() {
    if (!pushSupported()) { setNotify("unsupported"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setNotify(perm === "denied" ? "denied" : "off"); return; }
    try {
      // a subscription made earlier on the site's worker is dropped
      const site = await navigator.serviceWorker.getRegistration("/");
      const siteSub = site && site.scope === location.origin + "/" && (await site.pushManager.getSubscription());
      if (siteSub) {
        await db.from("push_subscriptions").delete().eq("endpoint", siteSub.endpoint);
        await siteSub.unsubscribe().catch(() => {});
      }
      const reg = await staffWorker();
      // a fresh subscription each time (an old one may have been dropped by the phone)
      const old = await reg.pushManager.getSubscription();
      if (old) {
        await db.from("push_subscriptions").delete().eq("endpoint", old.endpoint);
        await old.unsubscribe().catch(() => {});
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64Bytes(O.vapidPublicKey) });
      setNotify((await saveSubscription(sub)) ? "on" : "error");
    } catch (e) { setNotify("error"); }
  }
  // Already on: keep this phone's subscription saved (it can change).
  async function refreshNotifications() {
    if (owner || !pushSupported()) return;
    if (Notification.permission === "denied") { setNotify("denied"); return; }
    if (Notification.permission !== "granted") { setNotify("off"); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration(STAFF_SCOPE);
      const sub = reg && reg.scope.endsWith(STAFF_SCOPE) && (await reg.pushManager.getSubscription());
      if (sub && (await saveSubscription(sub))) setNotify("on"); else setNotify("off");
    } catch (e) { setNotify("off"); }
  }

  // The server sends a notification to this account's phones right away.
  async function testNotification() {
    const label = $("#notify-test-label");
    label.textContent = "Envoi…";
    const { data, error } = await db.functions.invoke("push", { body: { mode: "test" } });
    const ok = !error && data && data.results && data.results.some((s) => s >= 200 && s < 300);
    label.textContent = ok ? "Envoyée ✓ — elle arrive dans quelques secondes"
      : data && data.phones === 0 ? "Aucun téléphone enregistré : activez d'abord les notifications"
      : "Échec de l'envoi : réactivez les notifications puis réessayez";
    if (!ok && data && data.phones) setNotify("off");
    setTimeout(() => { label.textContent = "Envoyer une notification test"; }, 8000);
  }

  /* ---------- Events ---------- */
  function bind() {
    $("#login-form").addEventListener("submit", signIn);
    $("#start-btn").addEventListener("click", startService);
    $("#start-logout").addEventListener("click", signOut);
    $("#logout-btn").addEventListener("click", signOut);
    $("#sound-btn").addEventListener("click", () => { unlockAudio(); beep(); });
    $("#menu-btn").addEventListener("click", openMenu);
    $("#menu-close").addEventListener("click", closeMenu);
    $("#menu-shade").addEventListener("click", closeMenu);
    $("#menu").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !["notify-btn", "notify-test", "print-btn"].includes(b.id)) closeMenu(); });
    $("#menu-install").addEventListener("click", install);
    $("#notify-btn").addEventListener("click", enableNotifications);
    $("#notify-test").addEventListener("click", testNotification);
    $("#cancel-reasons").addEventListener("click", (e) => { const b = e.target.closest("[data-reason]"); if (b) cancel(b.dataset.reason); });
    $("#cancel-back").addEventListener("click", () => { $("#cancel-box").hidden = true; });
    $("#clear-btn").addEventListener("click", clearTests);
    $("#install-btn").addEventListener("click", install);
    $("#print-btn").addEventListener("click", cyclePrint);
    renderPrint();
    $$("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    $("#stats-periods").addEventListener("click", (e) => {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      statsPeriod = b.dataset.period;
      $$("#stats-periods [data-period]").forEach((x) => x.classList.toggle("is-on", x === b));
      loadStats();
    });
    $("#stats-sites").addEventListener("click", (e) => {
      const b = e.target.closest("[data-site]");
      if (!b) return;
      statsSite = b.dataset.site;
      $$("#stats-sites [data-site]").forEach((x) => x.classList.toggle("is-on", x === b));
      loadStats();
    });
    $("#alert-times").addEventListener("click", (e) => { const b = e.target.closest("[data-eta]"); if (b) accept(Number(b.dataset.eta)); });
    $("#alert-refuse").addEventListener("click", () => { $("#alert-main").hidden = true; $("#alert-reasons").hidden = false; });
    $("#alert-back").addEventListener("click", () => { $("#alert-main").hidden = false; $("#alert-reasons").hidden = true; });
    $("#alert-reasons").addEventListener("click", (e) => { const b = e.target.closest("[data-reason]"); if (b) refuse(b.dataset.reason); });
    $(".board").addEventListener("click", async (e) => {
      const ans = e.target.closest("[data-answer]");
      if (ans) { alertId = ans.dataset.answer; $("#alert").dataset.id = ""; render(); return; }
      const cb = e.target.closest("[data-cancel]");
      if (cb) { askCancel(cb.dataset.cancel); return; }
      const pr = e.target.closest("[data-print]");
      if (pr) { printOrder(orders.get(pr.dataset.print)); return; }
      const drv = e.target.closest("[data-driver]");
      if (drv) { sendToDriver(drv.dataset.driver); return; }
      const b = e.target.closest("[data-status]");
      if (!b) return;
      b.disabled = true;
      if (!(await update(b.dataset.id, { status: b.dataset.status }))) { b.disabled = false; alert("Échec. Vérifiez la connexion et réessayez."); }
    });
    addEventListener("online", () => { setOnline(true); if ((site || owner) && !$("#app").hidden) poll(); });
    addEventListener("offline", () => setOnline(false));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !(site || owner) || $("#app").hidden) return;
      keepAwake();
      unlockAudio();
      poll();
    });
    addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
    addEventListener("appinstalled", () => { installPrompt = null; renderInstall(); });
    // The staff app's own worker: installable, quick to open, and its notifications.
    if ("serviceWorker" in navigator && window.isSecureContext) {
      addEventListener("load", () => navigator.serviceWorker.register(STAFF_SW, { scope: STAFF_SCOPE }).catch(() => {}));
    }
  }

  bind();
  // the opening animation, then the screen
  setTimeout(() => $("#splash").classList.add("is-gone"), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100);
  db.auth.getSession().then(({ data }) => { if (data.session) afterSignIn(); else show("login"); });
})();
