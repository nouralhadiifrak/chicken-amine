/*
 * End-to-end checks in headless Chromium (Playwright).
 *   npx playwright test is not needed: run with  node tests/site.test.js
 * Serves the site on a local port, then checks phone (390 px) and desktop widths, in French and Arabic:
 * language/SEO tags, every menu category in the sticky bar, pickup and delivery orders sent to
 * WhatsApp, the closed-hours warning, sizes/sauces/per-piece support, reduced motion and JS errors.
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
  const ids = await page.$$eval(".chip", (cs) => cs.map((c) => c.dataset.cat));
  let ok = 0;
  const bad = [];
  for (const id of ids) {
    await page.click(`.chip[data-cat="${id}"]`);
    await page.waitForTimeout(900);
    const r = await page.evaluate((id) => {
      const active = document.querySelector(".chip.is-active");
      const sec = document.getElementById("cat-" + id);
      const offset = document.querySelector("#header").offsetHeight + document.querySelector("#catbar").offsetHeight;
      const top = sec.getBoundingClientRect().top;
      const atBottom = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2;
      const chip = active && active.getBoundingClientRect();
      const bar = document.querySelector("#catbar").getBoundingClientRect();
      const chipVisible = chip && chip.left >= bar.left - 1 && chip.right <= bar.right + 1;
      return { active: active && active.dataset.cat, placed: (top >= offset - 2 && top <= offset + 20) || (atBottom && top >= offset - 2 && top < innerHeight), chipVisible };
    }, id);
    if (r.active === id && r.placed && r.chipVisible) ok++; else bad.push(`${id} (active=${r.active}, placed=${r.placed}, chip visible=${r.chipVisible})`);
  }
  check(ok === ids.length, `${label}: every category in the bar scrolls to its section and lights up (${ok}/${ids.length})${bad.length ? " — " + bad.join(", ") : ""}`);

  // Scrolling by hand highlights the category under the bar.
  let spyOk = 0, spyTotal = 0;
  for (const id of ids) {
    const reachable = await page.evaluate((id) => {
      const sec = document.getElementById("cat-" + id);
      const offset = document.querySelector("#header").offsetHeight + document.querySelector("#catbar").offsetHeight + 8;
      const y = sec.getBoundingClientRect().top + scrollY - offset + 2;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (y > max) return false;
      scrollTo({ top: y, behavior: "instant" });
      return true;
    }, id);
    if (!reachable) continue;
    spyTotal++;
    await page.waitForTimeout(250);
    const active = await page.$eval(".chip.is-active", (c) => c.dataset.cat);
    if (active === id) spyOk++;
  }
  check(spyTotal > 0 && spyOk === spyTotal, `${label}: scrolling through the menu highlights each category (${spyOk}/${spyTotal})`);
}

async function addSimple(page, id) {
  const li = page.locator(`.item[data-item="${id}"]`);
  const add = li.locator("[data-add]");
  if (await add.count()) await add.click(); else await li.locator("[data-inc]").click();
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
      const menuTop = await page.$eval("#cat-salades", (e) => e.getBoundingClientRect().top);
      check(menuTop < 300, `${label}: "Commander" scrolls to the menu`);

      // Latin words in Arabic text keep left-to-right order.
      if (lang === "ar") {
        const ltr = await page.$$eval("#menu-list .ltr", (els) => els.map((e) => [e.textContent, getComputedStyle(e).direction]));
        check(ltr.length > 0 && ltr.every(([, d]) => d === "ltr"), `${label}: ${ltr.length} Latin runs isolated left-to-right (e.g. "${ltr[0] && ltr[0][0]}")`);
      }

      await testCategories(page, label);

      // Pickup order: two simple items, one item with a required option.
      await page.evaluate(() => scrollTo(0, 0));
      await addSimple(page, "tc-mixte");
      await addSimple(page, "tc-mixte");
      await addSimple(page, "bs-soda");
      await page.click('[data-choose="pl-sandwich-amine"]');
      await page.click("#options-submit");
      const reqErr = await page.textContent("#options-error");
      check(reqErr.length > 0, `${label}: a required option must be chosen ("${reqErr}")`);
      await page.check('#options-body input[name="opt-sandwich"][value="cordon"]');
      await page.click("#options-submit");
      const stepper = await page.textContent('.item[data-item="tc-mixte"] output');
      check(stepper.trim() === "2", `${label}: quantity stepper shows 2`);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chickenamine.cart.v1")).length);
      check(stored === 3, `${label}: cart saved in the browser (${stored} lines)`);

      await page.click("#cart-bar");
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
      const pickupOk = m1 && /2 × /.test(m1.text) && /169/.test(m1.text) && /Sans oignon/.test(m1.text) && /(Cordon bleu|كوردون بلو)/.test(m1.text) && !/30 (DH|درهم)/.test(m1.text);
      check(pickupOk, `${label}: pickup message has items, option, notes, total 169 and no delivery fee`);

      // Delivery: needs a position, refuses beyond 3 km, accepts inside with a 30 DH fee.
      await page.check('input[name="mode"][value="delivery"]');
      await page.waitForSelector("#delivery-map.leaflet-container", { state: "attached", timeout: 8000 });
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.__opened = []; });
      await page.click("#send-btn");
      check(!(await sentMessage(page)), `${label}: delivery without a position is not sent`);
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
      const chipsAfter = await page.$$eval(".chip", (c) => c.length);
      check(chipsAfter === 19, `${label}: category bar rebuilt after switching language`);

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
    await addSimple(page, "bg-cheese");
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
    check(/la pièce/.test(await page.textContent('.item[data-item="t-piece"]')), "per-piece price shows « / la pièce »");
    await page.click('[data-choose="t-size"]');
    await page.check('#options-body input[name="size"][value="L"]');
    check(/45/.test(await page.textContent("#options-submit")), "choosing size L shows 45 DH");
    await page.check('#options-body input[value="algerienne"]');
    await page.check('#options-body input[value="biggy"]');
    check(await page.isDisabled('#options-body input[value="harissa"]'), "a third sauce cannot be ticked");
    await page.click("#options-submit");
    await addSimple(page, "t-piece");
    await addSimple(page, "t-piece");
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
