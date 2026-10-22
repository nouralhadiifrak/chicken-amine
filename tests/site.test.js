/*
 * End-to-end checks in headless Chromium (Playwright).
 *   npx playwright test is not needed: run with  node tests/site.test.js
 * Serves the site on a local port, then checks phone (390 px) and desktop widths, in French and Arabic:
 * language/SEO tags, the intro, the header, category tiles and the category view, emojis and the
 * sauce sheet, pickup and delivery orders sent to WhatsApp, the closed-hours warning, sizes/sauces/per-piece support, reduced motion and JS errors.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

let failures = 0;
function check(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { failures++; console.log("  ✗ " + msg); }
}

// Casablanca is UTC+1 outside Ramadan (UTC+0 during it): 13:00 UTC is open either way, 09:00 UTC is closed.
const OPEN_TIME = new Date("2026-10-21T13:00:00Z");
const CLOSED_TIME = new Date("2026-10-21T09:00:00Z");

async function newPage(browser, base, { width, height, lang, time = OPEN_TIME, reducedMotion = "no-preference", geo, fixture = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion,
    geolocation: geo,
    permissions: geo ? ["geolocation"] : [],
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const txt = m.text();
    // Third-party resources (map tiles, Google embed, fonts) may be unreachable from the test machine.
    if (/Failed to load resource|ERR_|net::/.test(txt)) return;
    errors.push(txt);
  });
  await page.clock.setFixedTime(time);
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return {}; };
  });
  if (fixture) {
    // Test-only item exercising sizes, per-piece price and the sauce choice (the real menu has none).
    await page.route("**/js/menu-data.js", async (route) => {
      const body = fs.readFileSync(path.join(ROOT, "js/menu-data.js"), "utf8") + `
        window.SAUCES = [{ id: "algerienne", fr: "Algérienne", ar: "جزائرية" }, { id: "biggy", fr: "Biggy", ar: "بيغي" }, { id: "harissa", fr: "Harissa", ar: "هريسة" }];
        window.MENU.push({ id: "test", fr: "Test", ar: "اختبار", icon: "pizza", image: "", items: [
          { id: "t-size", fr: "Pizza Test", ar: "بيتزا اختبار", prices: { M: 30, L: 45 }, sauces: true },
          { id: "t-piece", fr: "Nugget Test", ar: "ناجت اختبار", price: 4, unit: "pc" } ] });`;
      route.fulfill({ body, contentType: "text/javascript" });
    });
  }
  await page.goto(base + (lang === "ar" ? "/?lang=ar" : "/"));
  return { page, context, errors };
}

async function waitIntro(page) {
  await page.waitForFunction(() => document.querySelector("#intro").classList.contains("is-done"), null, { timeout: 5000 });
}

async function sentMessage(page) {
  const urls = await page.evaluate(() => window.__opened);
  if (!urls.length) return null;
  const u = new URL(urls[urls.length - 1]);
  return { to: u.pathname, text: u.searchParams.get("text") };
}

async function testCategories(page, label) {
  // Only the category tiles are shown at first.
  const home = await page.evaluate(() => ({ tiles: document.querySelectorAll(".cat-tile").length, detail: document.querySelector("#menu-detail").hidden, items: document.querySelectorAll(".item").length }));
  check(home.tiles === 19 && home.detail && home.items === 0, `${label}: menu shows only the 19 category tiles (${home.tiles} tiles, ${home.items} dishes listed)`);

  const covers = await page.$$eval(".cat-tile img", (is) => is.length);
  check(covers === 19, `${label}: all 19 category tiles have a photo cover`);
  // A tile opens that category alone.
  await page.click('.cat-tile[data-open-cat="tacos"]');
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => ({
    hash: location.hash, grid: document.querySelector("#cat-grid").hidden,
    cats: [...document.querySelectorAll("#menu-list .category")].map((c) => c.dataset.cat),
    items: document.querySelectorAll("#menu-list .item").length,
    top: document.querySelector("#menu-detail").getBoundingClientRect().top,
  }));
  check(opened.grid && opened.cats.join() === "tacos" && opened.items === 8 && opened.hash === "#categorie-tacos", `${label}: tapping « Tacos » shows its 8 dishes only (${opened.hash})`);
  check(opened.top < 300, `${label}: the open category is scrolled into view`);

  // Every chip switches the category shown and stays visible in the bar.
  const ids = await page.$$eval(".chip", (cs) => cs.map((c) => c.dataset.cat));
  const counts = await page.evaluate(() => Object.fromEntries(window.MENU.map((c) => [c.id, c.items.length])));
  let ok = 0;
  const bad = [];
  for (const id of ids) {
    await page.click(`.chip[data-cat="${id}"]`);
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => {
      const active = document.querySelector(".chip.is-active");
      const bar = document.querySelector("#catbar-track").getBoundingClientRect();
      const chip = active && active.getBoundingClientRect();
      return {
        active: active && active.dataset.cat, hash: location.hash,
        cats: [...document.querySelectorAll("#menu-list .category")].map((c) => c.dataset.cat).join(),
        items: document.querySelectorAll("#menu-list .item").length,
        chipVisible: chip && chip.left >= bar.left - 1 && chip.right <= bar.right + 1,
      };
    });
    if (r.active === id && r.cats === id && r.items === counts[id] && r.hash === "#categorie-" + id && r.chipVisible) ok++;
    else bad.push(`${id} (${JSON.stringify(r)})`);
  }
  check(ids.length === 19 && ok === ids.length, `${label}: every chip shows its own category with all its dishes (${ok}/${ids.length})${bad.length ? " — " + bad.join(", ") : ""}`);

  // « Toutes les catégories » and the browser's back button both return to the tiles.
  await page.click("#back-to-cats");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.querySelector("#cat-grid").hidden && document.querySelector("#menu-detail").hidden), `${label}: « Toutes les catégories » returns to the tiles`);
  await page.click('.cat-tile[data-open-cat="burgers"]');
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.querySelector("#cat-grid").hidden && !/categorie/.test(location.hash)), `${label}: the browser's back button returns to the tiles`);
  await page.goForward();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector("#menu-list .category")?.dataset.cat === "burgers"), `${label}: forward opens the category again`);
}

// Pills hide their input under the label, so tick them the way a customer does: on the label.
async function pick(page, sel) {
  await page.locator(sel).locator("xpath=..").click();
}

async function openCat(page, id) {
  if (await page.$(`.chip[data-cat="${id}"]`)) {
    if (!(await page.$(`.chip.is-active[data-cat="${id}"]`))) await page.click(`.chip[data-cat="${id}"]`);
  } else await page.click(`.cat-tile[data-open-cat="${id}"]`);
  await page.waitForSelector(`#menu-list .category[data-cat="${id}"]`);
}

// Adds one dish; when the sauce sheet follows, picks the given sauces or skips.
async function addDish(page, cat, id, sauces) {
  await openCat(page, cat);
  await page.click(`.item[data-item="${id}"] [data-add]`);
  if (sauces === undefined) return;
  await page.waitForSelector("#sauce-dialog[open]", { timeout: 2000 });
  await page.waitForTimeout(250);
  if (!sauces.length) { await page.click("#sauce-skip"); return; }
  for (const v of sauces) await pick(page, `#sauce-list input[value="${v}"]`);
  await page.click("#sauce-ok");
}

async function main() {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const sizes = [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 860 }];

  for (const s of sizes) {
    for (const lang of ["fr", "ar"]) {
      const label = `${s.name} ${lang}`;
      console.log(`\n${label}`);
      const { page, context, errors } = await newPage(browser, base, { ...s, lang });

      // Intro and hero title timing.
      await waitIntro(page);
      await page.waitForFunction(() => document.querySelector(".hero__title").dataset.stMs, null, { timeout: 4000 });
      const heroMs = +(await page.$eval(".hero__title", (h) => h.dataset.stMs));
      const introMs = Math.round(await page.evaluate(() => performance.now()));
      check(heroMs < 1000, `${label}: hero title fully shown in ${heroMs} ms (page ready after ~${introMs} ms incl. intro)`);
      const units = await page.$$eval(".hero__title .st-unit", (us) => us.map((u) => u.textContent));
      if (lang === "ar") check(units.every((u) => !/^.$/u.test(u) || units.length < 3), `${label}: Arabic title animates word by word (${units.length} words)`);
      else check(units.length > 15, `${label}: French title animates letter by letter (${units.length} letters)`);
      const headerLogo = await page.$eval("#header-logo", (i) => getComputedStyle(i).opacity);
      check(headerLogo === "1", `${label}: logo has glided into the header`);
      const layers = await page.$$eval(".intro__layer", (ls) => ls.map((l) => [l.classList[1].replace("intro__", ""), l.naturalWidth > 0, getComputedStyle(l).opacity]));
      check(layers.length === 4 && layers.every(([, ok, op]) => ok && op === "1"), `${label}: intro built the logo from its layers (${layers.map(([n]) => n).join(", ")})`);
      const video = await page.$eval("#hero-media video", (v) => ({ src: v.currentSrc.split("/").pop(), paused: v.paused, poster: !!v.poster })).catch(() => null);
      check(video && /^hero\.(webm|mp4)$/.test(video.src) && !video.paused && video.poster, `${label}: hero video plays (${video && video.src})`);
      const band = await page.evaluate(() => ({
        items: document.querySelectorAll("#band-front .band__group:first-child [data-open-cat]").length,
        front: getComputedStyle(document.querySelector("#band-front")).animationName,
        paper: getComputedStyle(document.querySelector(".paper__sheet")).clipPath.startsWith("polygon") && getComputedStyle(document.querySelector(".paper__sheet")).backgroundColor !== "rgb(0, 0, 0)",
      }));
      check(band.items === 19 && /band/.test(band.front) && band.paper, `${label}: a torn-paper strip carries the ${band.items} categories, moving`);
      const look = await page.evaluate(() => ({ upper: getComputedStyle(document.querySelector(".hero__title")).textTransform, loc: getComputedStyle(document.querySelector("#location-btn")).backgroundColor }));
      check(look.upper === "uppercase" && look.loc === "rgb(225, 6, 15)", `${label}: hero title in capitals, « Voir la localisation » in red`);
      check(!(await page.$("#header.is-floating")), `${label}: header has no shadow at the top of the page`);

      // Language, title, description, canonical.
      const meta = await page.evaluate(() => ({
        lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title,
        desc: document.querySelector('meta[name="description"]').content, canonical: document.querySelector('link[rel="canonical"]').href,
        toggle: document.querySelector("#lang-toggle").textContent, toggleDir: document.querySelector("#lang-toggle").dir,
      }));
      check(meta.lang === lang && meta.dir === (lang === "ar" ? "rtl" : "ltr"), `${label}: lang="${meta.lang}" dir="${meta.dir}"`);
      check(/Sidi Moumen|سيدي مومن/.test(meta.title) && /Casablanca|الدار البيضاء/.test(meta.title) && /[Tt]acos|طاكوس/.test(meta.title), `${label}: title names the dishes, the neighbourhood and Casablanca`);
      check(meta.canonical.endsWith(lang === "ar" ? "/?lang=ar" : "/"), `${label}: canonical ${meta.canonical}`);
      if (lang === "ar") check(meta.toggle === "Français" && meta.toggleDir === "ltr", `${label}: "Français" toggle keeps left-to-right order`);
      const status = await page.$eval("#status", (e) => e.className);
      check(/is-open/.test(status), `${label}: shows open at 14:00 Casablanca time`);

      // Hero buttons.
      const loc = await page.$eval("#location-btn", (a) => a.href);
      check(/share\.google|google\.[a-z.]+\/maps/.test(loc), `${label}: "Voir la localisation" opens the Google listing`);
      await page.click("#order-btn");
      await page.waitForTimeout(900);
      const menuTop = await page.$eval("#menu", (e) => e.getBoundingClientRect().top);
      check(menuTop < 300, `${label}: "Commander" scrolls to the menu`);

      await testCategories(page, label);
      await page.click('#band-front .band__group:first-child [data-open-cat="pizzas"]', { force: true });
      await page.waitForTimeout(600);
      check(await page.evaluate(() => document.querySelector("#menu-list .category")?.dataset.cat === "pizzas"), `${label}: tapping « Pizzas » in the band opens that category`);

      // Pickup order: a tacos with two sauces, a tacos without sauce, a soda (no sauces), a dish with a required option.
      await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
      await openCat(page, "tacos");
      check(await page.$eval('.item[data-item="tc-mixte"]', (li) => !!li.querySelector(".item__thumb") && !!li.querySelector("[data-add] svg") && !/Ajouter|أضف/.test(li.querySelector("[data-add]").textContent)), `${label}: each dish has a picture and a round + button`);
      if (s.name === "phone") {
        const card = await page.evaluate(() => {
          const cols = getComputedStyle(document.querySelector("#menu-list .items")).gridTemplateColumns.split(" ").length;
          const li = document.querySelector('.item[data-item="tc-mixte"]');
          return { cols, full: Math.abs(li.querySelector(".item__thumb").offsetWidth - li.offsetWidth) < 2 };
        });
        check(card.cols === 2 && card.full, `${label}: dishes are cards like the category tiles, ${card.cols} per row, picture on top`);
      }
      await page.waitForFunction(() => { const i = document.querySelector('.item[data-item="tc-mixte"] .item__thumb img'); return i && i.complete; }, null, { timeout: 5000 }).catch(() => {});
      const photo = await page.evaluate(() => {
        const i = document.querySelector('.item[data-item="tc-mixte"] .item__thumb img');
        return i ? i.naturalWidth : 0;
      });
      check(photo > 0, `${label}: Tacos Mixte shows its photo (${photo} px wide)`);
      // Sauces first: nothing is added and nothing flies until the sauce sheet is settled.
      await page.click('.item[data-item="tc-mixte"] [data-add]');
      await page.waitForSelector("#sauce-dialog[open]", { timeout: 2000 });
      const early = await page.evaluate(() => ({ emojis: document.querySelectorAll(".spree").length, lines: (JSON.parse(localStorage.getItem("chickenamine.cart.v1") || "[]")).length }));
      check(early.emojis === 0 && early.lines === 0, `${label}: the sauce sheet opens first, before any emoji flies or anything is added`);
      await page.waitForTimeout(250);
      check(await page.isDisabled("#sauce-ok"), `${label}: « Valider » waits for a sauce`);
      await pick(page, '#sauce-list input[value="algerienne"]');
      await pick(page, '#sauce-list input[value="andalouse"]');
      check(await page.isDisabled('#sauce-list input[value="harissa"]'), `${label}: a third sauce cannot be ticked`);
      await page.click("#sauce-ok");
      await page.waitForTimeout(60);
      const fx = await page.evaluate(() => ({ emojis: document.querySelectorAll(".spree").length, text: [...document.querySelectorAll(".spree")].map((e) => e.textContent).join("") }));
      check(fx.emojis >= 12 && /🌮/.test(fx.text), `${label}: after « Valider », Tacos Mixte goes in and ${fx.emojis} emojis fly (${[...new Set([...fx.text])].join("")})`);
      check(await page.$eval("#cart-btn .cart-ico", (i) => i.classList.contains("is-looping")), `${label}: cart icon rocks once the order has a dish`);
      // Closing the sheet adds nothing.
      await page.waitForTimeout(400);
      await page.click('.item[data-item="tc-poulet"] [data-add]');
      await page.waitForSelector("#sauce-dialog[open]");
      await page.click('#sauce-dialog .icon-btn');
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !JSON.parse(localStorage.getItem("chickenamine.cart.v1")).some((l) => l.id === "tc-poulet")), `${label}: closing the sauce sheet adds nothing`);
      await page.waitForTimeout(200);
      await addDish(page, "tacos", "tc-mixte", []);
      await addDish(page, "boissons", "bs-soda");
      // Latin words in Arabic text keep left-to-right order.
      if (lang === "ar") {
        const ltr = await page.$$eval("#menu-list .ltr", (els) => els.map((e) => [e.textContent, getComputedStyle(e).direction]));
        check(ltr.length > 0 && ltr.every(([, d]) => d === "ltr"), `${label}: ${ltr.length} Latin runs isolated left-to-right (e.g. "${ltr[0] && ltr[0][0]}")`);
      }
      await page.waitForTimeout(600);
      check(!(await page.$("#sauce-dialog[open]")), `${label}: no sauce sheet for a drink`);
      await addDish(page, "salades", "sal-nicoise");
      await page.waitForTimeout(800);
      check(!(await page.$("#sauce-dialog[open]")), `${label}: no sauce sheet for a salad`);
      await openCat(page, "plats");
      await page.click('.item[data-item="pl-sandwich-amine"] [data-add]');
      await pick(page, '#options-body input[name="opt-sandwich"][value="thon"]');
      await page.click("#options-dialog .icon-btn");
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !JSON.parse(localStorage.getItem("chickenamine.cart.v1")).some((l) => l.id === "pl-sandwich-amine")), `${label}: closing the options sheet with ✕ adds nothing`);
      await page.click('.item[data-item="pl-sandwich-amine"] [data-add]');
      check(await page.isVisible('#options-body input[name="sauce"]'), `${label}: the options sheet also offers sauces`);
      await page.click("#options-submit");
      const reqErr = await page.textContent("#options-error");
      check(reqErr.length > 0, `${label}: a required option must be chosen ("${reqErr}")`);
      await pick(page, '#options-body input[name="opt-sandwich"][value="cordon"]');
      await page.click("#options-submit");
      await openCat(page, "tacos");
      const badge = await page.textContent('.item[data-item="tc-mixte"] .in-cart');
      check(badge.trim() === "2", `${label}: Tacos Mixte shows 2 in the order`);
      const lines = await page.evaluate(() => JSON.parse(localStorage.getItem("chickenamine.cart.v1")));
      check(lines.length === 5 && lines.some((l) => l.id === "tc-mixte" && (l.sauces || []).join() === "algerienne,andalouse") && lines.some((l) => l.id === "tc-mixte" && !l.sauces), `${label}: cart saved in the browser with sauces on their own line (${lines.length} lines)`);

      await page.click("#cart-bar");
      // The salad line: a bin at one, a minus above one, numbers that roll; then the bin removes it.
      const salad = '#cart-lines .cart-line:has([data-line-inc^="sal-nicoise"])';
      check(await page.$(`${salad} .stepper__bin`), `${label}: a dish at quantity 1 shows a bin instead of −`);
      await page.click(`${salad} [data-line-inc]`);
      await page.waitForTimeout(150);
      const rolling = await page.$$eval(`${salad} .roll__ch--out`, (o) => o.length);
      await page.waitForTimeout(700);
      const two = await page.evaluate((sel) => ({ qty: document.querySelector(`${sel} output`).textContent, total: document.querySelector(`${sel} .cart-line__total`).textContent, bin: !!document.querySelector(`${sel} .stepper__bin`) }), salad);
      check(rolling > 0 && two.qty === "2" && /^84 /.test(two.total) && !two.bin, `${label}: quantity and price roll to 2 · ${two.total}, the bin turns back into −`);
      await page.click(`${salad} [data-line-dec]`);
      await page.click(`${salad} .stepper__bin`);
      await page.waitForTimeout(700);
      check(!(await page.$(salad)), `${label}: the bin removes the dish`);
      const total = await page.textContent("#totals");
      check(/169/.test(total), `${label}: subtotal 2×47 + 10 + 65 = 169`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${lang}-cart.png` });
      await page.click("#cart-next");
      await page.fill('input[name="name"]', "Test Client");
      await page.fill('input[name="phone"]', "0600000000");
      await page.fill('textarea[name="notes"]', "Sans oignon");
      await page.click("#send-btn");
      const m1 = await sentMessage(page);
      check(m1 && m1.to === "/212634235350", `${label}: pickup order opens WhatsApp to +212634235350`);
      const pickupOk = m1 && /(Algérienne, Andalouse|جزائرية، أندلسية)/.test(m1.text) && /169/.test(m1.text) && /Sans oignon/.test(m1.text) && /(Cordon bleu|كوردون بلو)/.test(m1.text) && !/30 (DH|درهم)/.test(m1.text);
      check(pickupOk, `${label}: pickup message has items, sauces, option, notes, total 169 and no delivery fee`);

      // Delivery: needs a position, refuses beyond 3 km, accepts inside with a 30 DH fee.
      await pick(page, 'input[name="mode"][value="delivery"]');
      await page.waitForSelector("#delivery-map.leaflet-container", { state: "attached", timeout: 8000 });
      check(await page.evaluate(() => getComputedStyle(document.querySelector("#gps-btn")).backgroundColor === "rgb(225, 6, 15)" && document.querySelectorAll(".mode__opt .mode__icon").length === 2), `${label}: « Utiliser ma position » in red, icons on both modes`);
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.__opened = []; });
      await page.click("#send-btn");
      check(!(await sentMessage(page)), `${label}: delivery without a position is not sent`);
      await page.waitForTimeout(700);
      const totalDelivery = await page.textContent("#totals");
      check(/199/.test(totalDelivery), `${label}: total with 30 DH delivery = 199`);
      // Tap the map 1 km east of the restaurant.
      const pt = await page.evaluate(() => {
        const map = document.querySelector("#delivery-map");
        return { x: map.getBoundingClientRect().left + map.clientWidth / 2 + 60, y: map.getBoundingClientRect().top + map.clientHeight / 2 };
      });
      await page.mouse.click(pt.x, pt.y);
      const st = await page.textContent("#delivery-status");
      check(/km|كلم/.test(st) && !(await page.$("#delivery-status.is-error")), `${label}: tapped point accepted ("${st.trim()}")`);
      await page.fill('input[name="address"]', "Rue 12, immeuble 3");
      await page.click("#send-btn");
      const m2 = await sentMessage(page);
      const deliveryOk = m2 && /30 (DH|درهم)/.test(m2.text) && /199/.test(m2.text) && /maps\.google\.com\/\?q=33\.\d+,-7\.\d+/.test(m2.text) && /Rue 12/.test(m2.text);
      check(deliveryOk, `${label}: delivery message has fee, total 199, address and map link`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${lang}-delivery.png` });

      // Far point: GPS position about 7 km away.
      await context.setGeolocation({ latitude: 33.62, longitude: -7.47 });
      await context.grantPermissions(["geolocation"]);
      await page.click("#gps-btn");
      await page.waitForSelector("#delivery-status.is-error", { timeout: 5000 }).catch(() => {});
      const far = await page.textContent("#delivery-status");
      await page.evaluate(() => { window.__opened = []; });
      await page.click("#send-btn");
      check(/3 /.test(far) && !(await sentMessage(page)), `${label}: GPS position beyond 3 km refused ("${far.trim().slice(0, 60)}…")`);

      // Language toggle updates the address, title and canonical.
      await page.click("#cart-close");
      await page.click("#lang-toggle");
      const after = await page.evaluate(() => ({ url: location.search, lang: document.documentElement.lang, canonical: document.querySelector('link[rel="canonical"]').href }));
      const want = lang === "ar" ? "fr" : "ar";
      check(after.lang === want && (want === "ar" ? after.url === "?lang=ar" : after.url === "") && after.canonical.endsWith(want === "ar" ? "/?lang=ar" : "/"), `${label}: toggle switches to ${want}, address "${after.url || "/"}"`);
      const rebuilt = await page.evaluate((want) => ({ tiles: document.querySelectorAll(".cat-tile").length, chips: document.querySelectorAll(".chip").length, name: document.querySelector("#menu-list .category__title")?.textContent || "" }), want);
      check(rebuilt.tiles === 19 && rebuilt.chips === 19 && rebuilt.name.length > 0, `${label}: categories rebuilt after switching language (« ${rebuilt.name.trim()} »)`);
      if (s.name === "desktop") {
        check(await page.$("#header.is-floating"), `${label}: header gets its shadow once the page scrolls`);
        await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
        await page.waitForTimeout(300);
        const cur = await page.$eval('.header__nav a[aria-current="true"]', (a) => a.dataset.nav).catch(() => "");
        check(cur === "menu", `${label}: « Menu » underlined in the header while the menu is on screen`);
      }

      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(1300);
      const heroShown = await page.$eval(".hero__title", (h) => h.textContent.trim().length > 0 && [...h.querySelectorAll(".st-unit")].every((u) => getComputedStyle(u).opacity === "1"));
      check(heroShown, `${label}: hero title shown again after switching language and scrolling back up`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${lang}-top.png` });
      check(errors.length === 0, `${label}: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
      await context.close();
    }
  }

  // Closed: warning shown, order still sent with a note.
  console.log("\nclosed hours");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr", time: CLOSED_TIME });
    await waitIntro(page);
    check(/is-closed/.test(await page.$eval("#status", (e) => e.className)), "shows closed at 10:00 Casablanca time");
    await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
    await addDish(page, "burgers", "bg-cheese", []);
    await page.click("#cart-bar");
    await page.click("#cart-next");
    check(await page.isVisible("#closed-warning"), "closed warning shown in checkout");
    await page.fill('input[name="name"]', "A");
    await page.fill('input[name="phone"]', "0600000000");
    await page.click("#send-btn");
    const m = await sentMessage(page);
    check(m && /fermeture/.test(m.text), "order still sent, marked as sent while closed");
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // Sizes, sauces (max 2) and per-piece prices, with a test-only item.
  console.log("\nsizes, sauces, per-piece (test item)");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr", fixture: true });
    await waitIntro(page);
    await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
    await openCat(page, "test");
    check(/la pièce/.test(await page.textContent('.item[data-item="t-piece"]')), "per-piece price shows « / la pièce »");
    await page.click('.item[data-item="t-size"] [data-add]');
    await pick(page, '#options-body input[name="size"][value="L"]');
    await page.waitForTimeout(700);
    check(/^45 DH$/.test(await page.getAttribute("#options-price .roll", "aria-label") + " DH") && /Ajouter · 45 DH/.test(await page.textContent("#options-submit")), "choosing size L rolls the price to 45 DH");
    await page.click('.qty__btn[data-step="1"]');
    await page.waitForTimeout(700);
    check((await page.textContent("#options-qty")) === "2" && /90 DH/.test(await page.textContent("#options-submit")), "quantity 2 rolls the price to 90 DH");
    await page.click('.qty__btn[data-step="-1"]');
    await page.waitForTimeout(700);
    await pick(page, '#options-body input[value="algerienne"]');
    await pick(page, '#options-body input[value="biggy"]');
    check(await page.isDisabled('#options-body input[value="harissa"]'), "a third sauce cannot be ticked");
    await page.click("#options-submit");
    await addDish(page, "test", "t-piece");
    await addDish(page, "test", "t-piece");
    check(!(await page.$("#sauce-dialog[open]")), "no sauce sheet for a dish without sauces");
    await page.click("#cart-bar");
    check(/53/.test(await page.textContent("#totals")), "subtotal 45 + 2×4 = 53");
    await page.click("#cart-next");
    await page.fill('input[name="name"]', "A");
    await page.fill('input[name="phone"]', "0600000000");
    await page.click("#send-btn");
    const m = await sentMessage(page);
    check(m && /Pizza Test \(L\)/.test(m.text) && /Sauces : Algérienne, Biggy/.test(m.text), "message lists the size and the two sauces");
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // Reduced motion: no intro, no heading animation.
  console.log("\nreduced motion");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "ar", reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      intro: getComputedStyle(document.querySelector("#intro")).display,
      split: document.querySelectorAll(".st-unit").length,
      btnAnim: getComputedStyle(document.querySelector(".btn"), "::before").animationName,
    }));
    check(r.intro === "none", "intro skipped");
    check(r.split === 0, "headings not split or animated");
    check(r.btnAnim === "none", "button border trails stopped");
    check(await page.$eval("#hero-media video", (v) => v.paused && !!v.poster), "hero video stays on its poster");
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // Review page.
  console.log("\n/avis/");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr" });
    await page.goto(base + "/avis/");
    check(await page.isVisible("#coming-soon"), "review page shows « Bientôt disponible » while no link is set");
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
