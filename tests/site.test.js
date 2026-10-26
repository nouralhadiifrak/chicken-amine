/*
 * End-to-end checks in headless Chromium (Playwright).
 *   npx playwright test is not needed: run with  node tests/site.test.js
 * Serves the site on a local port, then checks phone (390 px) and desktop widths, in French and Arabic:
 * language/SEO tags, the intro, the header, category tiles and the category view, emojis and the
 * sauce sheet, pickup and delivery orders sent to WhatsApp, the closed-hours warning, sizes/sauces/per-piece support, reduced motion and JS errors,
 * the choice between the two restaurants (each with its own WhatsApp, Instagram, phone and delivery area) and the Friday-only couscous.
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
// 2026-10-23 is a Friday: the couscous is served from 12:00 to 17:00.
const FRIDAY_LUNCH = new Date("2026-10-23T13:00:00Z");
const FRIDAY_EVENING = new Date("2026-10-23T18:00:00Z");
const SITE_KEY = "chickenamine.location.v1";

// Most checks run with a restaurant already chosen (as on a second visit); null leaves the first-visit choice.
async function presetSite(context, id = "sidi-moumen") {
  if (!id) return;
  await context.addInitScript(([key, id]) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, id); } catch (e) { /* no storage */ } }, [SITE_KEY, id]);
}

async function newPage(browser, base, { width, height, lang, time = OPEN_TIME, reducedMotion = "no-preference", geo, fixture = false, site = "sidi-moumen" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion,
    geolocation: geo,
    permissions: geo ? ["geolocation"] : [],
    serviceWorkers: "block",
  });
  await presetSite(context, site);
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
    await page.route("**/js/menu-data.js*", async (route) => {
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
  check(home.tiles === 14 && home.detail && home.items === 0, `${label}: menu shows only the 14 category tiles (${home.tiles} tiles, ${home.items} dishes listed)`);

  const covers = await page.$$eval(".cat-tile img", (is) => is.length);
  check(covers === 14, `${label}: all 14 category tiles have a photo cover`);
  // A tile opens that category alone.
  await page.click('.cat-tile[data-open-cat="tacos"]');
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => ({
    hash: location.hash, grid: document.querySelector("#cat-grid").hidden,
    cats: [...document.querySelectorAll("#menu-list .category")].map((c) => c.dataset.cat),
    items: document.querySelectorAll("#menu-list .item").length,
    groups: [...document.querySelectorAll("#menu-list .items__group")].map((g) => g.textContent.trim()),
    top: document.querySelector("#menu-detail").getBoundingClientRect().top,
  }));
  check(opened.grid && opened.cats.join() === "tacos" && opened.items === 17 && opened.hash === "#categorie-tacos", `${label}: tapping « Tacos » shows its 17 dishes only (${opened.hash})`);
  check(opened.groups.length === 1 && /Gratin|غراتيني/.test(opened.groups[0]), `${label}: the gratinés follow under their own heading (« ${opened.groups.join(" / ")} »)`);
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
  check(ids.length === 14 && ok === ids.length, `${label}: every chip shows its own category with all its dishes (${ok}/${ids.length})${bad.length ? " — " + bad.join(", ") : ""}`);

  // A link to a section that was merged opens the category it now belongs to.
  await page.evaluate(() => { location.hash = "#categorie-crunchys"; });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector("#menu-list .category")?.dataset.cat === "sandwichs"), `${label}: an old « Crunchy's » link opens Sandwichs`);

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

      // Intro and hero title: the title stays hidden until it is handwritten (no flash of the whole text first).
      const during = [];
      for (let i = 0; i < 12; i++) {
        const v = await page.evaluate(() => ({ done: document.querySelector("#intro").classList.contains("is-done"), vis: getComputedStyle(document.querySelector(".hero__title")).visibility }));
        if (v.done) break;
        during.push(v.vis);
        await page.waitForTimeout(250);
      }
      check(during.length > 0 && during.every((v) => v === "hidden"), `${label}: the title is not shown before it is written (${during.length} checks during the intro)`);
      await waitIntro(page);
      const introMs = Math.round(await page.evaluate(() => performance.now()));
      await page.waitForFunction(() => document.querySelector(".hero__title").classList.contains("is-writing"), null, { timeout: 4000 });
      const sign = await page.$eval(".hero__title", (h) => ({
        lines: [...h.querySelectorAll(".hw-line")].map((l) => [getComputedStyle(l).animationName, getComputedStyle(l).animationDelay]),
        split: h.querySelectorAll(".st-unit").length, font: getComputedStyle(h).fontFamily, text: h.textContent.trim(),
      }));
      const wantFont = lang === "ar" ? /Aref Ruqaa/ : /Great Vibes/;
      const seq = sign.lines.length >= 2 && sign.lines.every(([n]) => /write/.test(n)) && parseFloat(sign.lines[1][1]) > parseFloat(sign.lines[0][1]);
      check(seq && sign.split === 0 && wantFont.test(sign.font), `${label}: « ${sign.text} » is handwritten line after line (${sign.lines.length} lines, ${sign.font.split(",")[0]}), page ready after ~${introMs} ms`);
      check(lang === "ar" ? /الأطباق/.test(sign.text) : /Les meilleurs plats à Casablanca/.test(sign.text), `${label}: hero keeps only the title and the buttons`);
      const headerLogo = await page.$eval("#header-logo", (i) => getComputedStyle(i).opacity);
      check(headerLogo === "1", `${label}: logo has glided into the header`);
      const layers = await page.$$eval(".intro__layer", (ls) => ls.map((l) => [l.classList[1].replace("intro__", ""), l.naturalWidth > 0, getComputedStyle(l).opacity]));
      check(layers.length === 4 && layers.every(([, ok, op]) => ok && op === "1"), `${label}: intro built the logo from its layers (${layers.map(([n]) => n).join(", ")})`);
      const video = await page.$eval("#hero-plate video", (v) => ({ src: v.currentSrc.split("/").pop(), paused: v.paused, poster: !!v.poster })).catch(() => null);
      check(video && /^hero-plate\.(webm|mp4)$/.test(video.src) && !video.paused && video.poster, `${label}: the plate turns in the hero (${video && video.src})`);
      const lay = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const t = r(".hero__title"), p = r("#hero-plate"), a = r(".hero__actions");
        return { stacked: t.bottom <= p.top + 40 && p.bottom <= a.top + 40, side: t.right <= p.left + 10 && a.right <= p.left + 10, dir: document.documentElement.dir };
      });
      const crumbs = await page.evaluate(() => {
        const p = document.querySelector("#hero-plate").getBoundingClientRect(), cx = p.left + p.width / 2;
        const imgs = [...document.querySelectorAll(".hero__crumbs img")];
        return { n: imgs.length, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0), left: imgs.filter((i) => i.getBoundingClientRect().right < cx - p.width * 0.3).length, right: imgs.filter((i) => i.getBoundingClientRect().left > cx + p.width * 0.3).length, moving: getComputedStyle(imgs[0]).animationName };
      });
      check(crumbs.n === 12 && crumbs.loaded && crumbs.left >= 4 && crumbs.right >= 4 && crumbs.moving === "crumb-float", `${label}: fries and herbs float on both sides of the plate (${crumbs.left} left, ${crumbs.right} right)`);
      const slate = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".hero")).backgroundImage, light: !!document.querySelector("#hero-plate .hero__light") }));
      check(/slate\.webp/.test(slate.bg) && slate.light, `${label}: hero has the video's dark slate and the light under the plate`);
      if (s.name === "phone") check(lay.stacked, `${label}: phone hero reads title, turning plate, then the buttons`);
      else check(lay.side || lay.dir === "rtl", `${label}: PC hero has the text and buttons on the left, the plate on the right`);
      const band = await page.evaluate(() => ({
        items: document.querySelectorAll("#band-front .band__group:first-child [data-open-cat]").length,
        front: getComputedStyle(document.querySelector("#band-front")).animationName,
        paper: getComputedStyle(document.querySelector(".paper__sheet")).clipPath.startsWith("polygon") && getComputedStyle(document.querySelector(".paper__sheet")).backgroundColor !== "rgb(0, 0, 0)",
      }));
      check(band.items === 14 && /band/.test(band.front) && band.paper, `${label}: a torn-paper strip carries the ${band.items} categories, moving`);
      const look = await page.evaluate(() => ({ loc: getComputedStyle(document.querySelector("#location-btn")).backgroundColor }));
      check(look.loc === "rgb(225, 6, 15)", `${label}: « Voir la localisation » in red`);
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
      check(await page.evaluate(() => window.__chickenAmine.isOpen()), `${label}: open at 14:00 Casablanca time`);

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
      check(!(await page.$(".category__media")), `${label}: no category photo beside the dishes`);
      // The photo shown big: a long press on a phone (a short tap does nothing), a click with a mouse.
      await page.waitForTimeout(900); // let the scroll to the category settle: scrolling cancels a long press
      if (s.name === "phone") {
        const press = (ms) => page.evaluate(async (ms) => {
          const img = document.querySelector('.item[data-item="tc-mixte"] .item__thumb img');
          img.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
          await new Promise((r) => setTimeout(r, ms));
          img.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
        }, ms);
        await press(120);
        check(!(await page.$("#photo-dialog[open]")), `${label}: a short tap on a photo does not open it`);
        await press(650);
      } else await page.click('.item[data-item="tc-mixte"] .item__thumb img');
      await page.waitForTimeout(200);
      const big = await page.evaluate(() => ({ open: !!document.querySelector("#photo-dialog[open]"), w: document.querySelector("#photo-img").getBoundingClientRect().width, name: document.querySelector("#photo-name").textContent }));
      check(big.open && big.w > (s.name === "phone" ? 340 : 500) && /Mixte|ميكس/.test(big.name), `${label}: ${s.name === "phone" ? "a long press" : "a click"} shows the photo big (${Math.round(big.w)} px, « ${big.name} »)`);
      await page.click("#photo-dialog");
      await page.waitForTimeout(200);
      check(!(await page.$("#photo-dialog[open]")), `${label}: a tap closes the big photo`);
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
      // Soda: the brand must be chosen.
      await openCat(page, "boissons");
      await page.click('.item[data-item="bs-soda"] [data-add]');
      await page.click("#options-submit");
      check((await page.textContent("#options-error")).length > 0 && (await page.$$eval('#options-body input[name="opt-marque"]', (b) => b.length)) === 10, `${label}: a soda asks for one of 10 brands before it is added`);
      await pick(page, '#options-body input[name="opt-marque"][value="pepsi"]');
      await page.click("#options-submit");
      // Latin words in Arabic text keep left-to-right order.
      if (lang === "ar") {
        const ltr = await page.$$eval(".ltr", (els) => els.map((e) => [e.textContent, getComputedStyle(e).direction]));
        check(ltr.length > 0 && ltr.every(([, d]) => d === "ltr"), `${label}: ${ltr.length} Latin runs isolated left-to-right (e.g. "${ltr[0] && ltr[0][0]}")`);
      }
      await page.waitForTimeout(600);
      check(!(await page.$("#sauce-dialog[open]")), `${label}: no sauce sheet for a drink`);
      await addDish(page, "salades", "sal-nicoise");
      await page.waitForTimeout(800);
      check(!(await page.$("#sauce-dialog[open]")), `${label}: no sauce sheet for a salad`);
      if (s.name === "phone" && lang === "fr") {
        for (const [cat, id] of [["chawarmas", "ch-normale"], ["broasters", "bro-2"]]) {
          await addDish(page, cat, id);
          await page.waitForTimeout(500);
          check(!(await page.$("#sauce-dialog[open]")), `${label}: no sauce sheet for ${id}`);
        }
        // take them out again so the order below stays the same
        await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("chickenamine.cart.v1")).filter((l) => !["ch-normale", "bro-2"].includes(l.id)); localStorage.setItem("chickenamine.cart.v1", JSON.stringify(c)); });
        await page.reload();
        await waitIntro(page);
        await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
      }
      // Chicken Tacos Amine: the tacos and the pâtes sauce are chosen first.
      await openCat(page, "plats");
      await page.click('.item[data-item="pl-tacos-amine"] [data-add]');
      await pick(page, '#options-body input[name="opt-tacos"][value="poulet"]');
      await page.click("#options-dialog .icon-btn");
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !JSON.parse(localStorage.getItem("chickenamine.cart.v1")).some((l) => l.id === "pl-tacos-amine")), `${label}: closing the options sheet with ✕ adds nothing`);
      await page.click('.item[data-item="pl-tacos-amine"] [data-add]');
      const tacosChoices = await page.$$eval('#options-body input[name="opt-tacos"]', (b) => b.map((x) => x.value).join());
      check(tacosChoices === "poulet,nuggets,chicken,viande,sepia,mixte" && await page.isVisible('#options-body input[name="sauce"]'), `${label}: Chicken Tacos Amine offers 6 tacos (${tacosChoices}) and the sauces`);
      await pick(page, '#options-body input[name="opt-tacos"][value="nuggets"]');
      await page.click("#options-submit");
      const reqErr = await page.textContent("#options-error");
      check(/pâtes|المعكرونة/.test(reqErr), `${label}: the pâtes sauce must be chosen ("${reqErr}")`);
      await pick(page, '#options-body input[name="opt-pates"][value="blanche"]');
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
      check(rolling > 0 && two.qty === "2" && /^50 /.test(two.total) && !two.bin, `${label}: quantity and price roll to 2 · ${two.total}, the bin turns back into −`);
      await page.click(`${salad} [data-line-dec]`);
      await page.click(`${salad} .stepper__bin`);
      await page.waitForTimeout(700);
      check(!(await page.$(salad)), `${label}: the bin removes the dish`);
      const total = await page.textContent("#totals");
      check(/132/.test(total), `${label}: subtotal 2×35 + 7 + 55 = 132`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${s.name}-${lang}-cart.png` });
      await page.click("#cart-next");
      await page.fill('input[name="name"]', "Test Client");
      await page.fill('input[name="phone"]', "0600000000");
      await page.fill('textarea[name="notes"]', "Sans oignon");
      await page.click("#send-btn");
      const m1 = await sentMessage(page);
      check(m1 && m1.to === "/212634385931", `${label}: pickup order opens the Sidi Moumen WhatsApp, +212634385931`);
      const pickupOk = m1 && /(Sidi Moumen|سيدي مومن)/.test(m1.text) && /(Pepsi|بيبسي)/.test(m1.text) && /(Algérienne, Andalouse|جزائرية، أندلسية)/.test(m1.text) && /132/.test(m1.text) && /Sans oignon/.test(m1.text) && /(Nuggets|ناجتس)/.test(m1.text) && /(Sauce blanche|الصلصة البيضاء)/.test(m1.text) && !/10 (DH|درهم)/.test(m1.text);
      check(pickupOk, `${label}: pickup message names the restaurant, has items, sauces, soda brand, tacos and pâtes choices, notes, total 132 and no delivery fee`);

      // Delivery: needs a position, refuses beyond 3 km, accepts inside with a 10 DH fee.
      await pick(page, 'input[name="mode"][value="delivery"]');
      await page.waitForSelector("#delivery-map.leaflet-container", { state: "attached", timeout: 8000 });
      check(await page.evaluate(() => getComputedStyle(document.querySelector("#gps-btn")).backgroundColor === "rgb(225, 6, 15)" && document.querySelectorAll(".mode__opt .mode__icon").length === 2), `${label}: « Utiliser ma position » in red, icons on both modes`);
      check(await page.evaluate(() => document.querySelector(".mode__opt.is-checked input").value === "delivery"), `${label}: the chosen mode is highlighted without :has() (older browsers)`);
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.__opened = []; });
      await page.click("#send-btn");
      check(!(await sentMessage(page)), `${label}: delivery without a position is not sent`);
      await page.waitForTimeout(700);
      const totalDelivery = await page.textContent("#totals");
      check(/142/.test(totalDelivery), `${label}: total with 10 DH delivery = 142`);
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
      const deliveryOk = m2 && /10 (DH|درهم)/.test(m2.text) && /142/.test(m2.text) && /maps\.google\.com\/\?q=33\.\d+,-7\.\d+/.test(m2.text) && /Rue 12/.test(m2.text);
      check(deliveryOk, `${label}: delivery message has fee, total 142, address and map link`);
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
      check(rebuilt.tiles === 14 && rebuilt.chips === 14 && rebuilt.name.length > 0, `${label}: categories rebuilt after switching language (« ${rebuilt.name.trim()} »)`);
      if (s.name === "desktop") {
        check(await page.$("#header.is-floating"), `${label}: header gets its shadow once the page scrolls`);
        await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
        await page.waitForTimeout(300);
        const cur = await page.$eval('.header__nav a[aria-current="true"]', (a) => a.dataset.nav).catch(() => "");
        check(cur === "menu", `${label}: « Menu » underlined in the header while the menu is on screen`);
      }

      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(1300);
      const heroShown = await page.$eval(".hero__title", (h) => h.textContent.trim().length > 0 && h.classList.contains("is-writing"));
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
    check(!(await page.evaluate(() => window.__chickenAmine.isOpen())), "closed at 10:00 Casablanca time");
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

  // Older mobile browsers without aspect-ratio (seen on an owner's Android phone): pictures must keep their size.
  console.log("\nbrowser without aspect-ratio (simulated)");
  {
    const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8")
      .replace("@supports not (aspect-ratio: 1 / 1)", "@media all")
      .replace(/aspect-ratio:[^;{}]+;/g, "");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await presetSite(context);
    const page = await context.newPage();
    await page.route("**/css/style.css*", (r) => r.fulfill({ body: css, contentType: "text/css" }));
    await page.goto(base + "/#categorie-tacos");
    await page.waitForTimeout(400);
    const stage = await page.$eval("#intro-stage", (e) => e.getBoundingClientRect().height);
    await waitIntro(page);
    const h = { stage, thumb: await page.$eval(".item__thumb", (e) => e.getBoundingClientRect().height) };
    await page.click("#back-to-cats");
    await page.waitForTimeout(300);
    const tile = await page.$eval(".cat-tile__media", (e) => e.getBoundingClientRect().height);
    check(tile > 80 && h.thumb > 80 && h.stage > 80, `category photos (${Math.round(tile)} px), dish photos (${Math.round(h.thumb)} px) and the intro logo keep their height`);
    await context.close();
  }

  // A phone that refuses to autoplay video (data or battery saver): the plate of the still frame turns instead.
  console.log("\nautoplay blocked (simulated)");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await presetSite(context);
    const page = await context.newPage();
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException("blocked", "NotAllowedError")); };
      Object.defineProperty(HTMLMediaElement.prototype, "autoplay", { get() { return false; }, set() {}, configurable: true });
      const sa = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (n, v) { if (this instanceof HTMLMediaElement && n === "autoplay") return; return sa.call(this, n, v); };
    });
    await page.goto(base + "/");
    await waitIntro(page);
    await page.waitForTimeout(3000);
    const a1 = await page.$eval(".hero__spin", (e) => getComputedStyle(e).transform);
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ spinning: document.querySelector("#hero-plate").classList.contains("is-spinning"), shown: getComputedStyle(document.querySelector(".hero__spin")).display, a2: getComputedStyle(document.querySelector(".hero__spin")).transform }));
    check(st.spinning && st.shown === "block" && a1 !== st.a2, "the plate still turns when the video cannot play");
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
    await page.waitForTimeout(600);
    check(await page.$eval("#hero-plate video", (v) => !v.paused), "the slow plate still turns (it is the point of the hero; nothing flashes)");
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // First visit: the restaurant must be chosen; the nearest one is found with the GPS.
  for (const lang of ["fr", "ar"]) {
    const label = `choosing the restaurant ${lang}`;
    console.log("\n" + label);
    // A customer about 700 m from Bouchaib Doukkali, 5 km from Sidi Moumen.
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang, site: null, geo: { latitude: 33.5700, longitude: -7.5800 } });
    await waitIntro(page);
    await page.waitForSelector("#site-dialog[open]", { timeout: 3000 });
    const first = await page.evaluate(() => ({ cards: document.querySelectorAll("#site-list [data-site]").length, close: !document.querySelector("#site-close").hidden }));
    check(first.cards === 2 && !first.close, `${label}: after the intro, the 2 restaurants are offered and the sheet has no ✕`);
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    check(await page.$("#site-dialog[open]"), `${label}: Escape or a tap outside does not skip the choice`);
    await page.click("#site-gps");
    await page.waitForSelector("#site-list .is-nearest", { timeout: 5000 });
    const near = await page.evaluate(() => ({ id: document.querySelector("#site-list .is-nearest").dataset.site, tag: document.querySelector("#site-list .is-nearest .site-card__tag").textContent }));
    check(near.id === "bouchaib-doukkali" && /0[,.]\d (km|كلم)/.test(near.tag), `${label}: « Trouver le plus proche » marks Bouchaib Doukkali (« ${near.tag.trim()} »)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/site-${lang}-chooser.png` });
    await page.click("#site-list .is-nearest");
    await page.waitForTimeout(300);
    const links = await page.evaluate(() => ({
      open: !!document.querySelector("#site-dialog[open]"), saved: localStorage.getItem("chickenamine.location.v1"),
      ig: document.querySelector("#ig-float").href, phone: document.querySelector("#info-phone").href, header: document.querySelector("#site-btn-name").textContent,
      maps: document.querySelector("#location-btn").href, embed: document.querySelector("#map-embed").src,
    }));
    check(!links.open && links.saved === "bouchaib-doukkali", `${label}: the choice closes the sheet and is remembered`);
    check(links.ig === "https://www.instagram.com/chicken_amine_2/", `${label}: the Instagram button opens @chicken_amine_2`);
    check(links.phone === "tel:+212664496296" && /Bouchaib|بوشعيب/.test(links.header), `${label}: phone 06 64 49 62 96, header shows « ${links.header} »`);
    check(/Chicken\+Amine\+2/.test(links.maps) && /33\.5673/.test(links.embed), `${label}: location button and map show Chicken Amine 2`);
    // A delivery order goes to this restaurant's WhatsApp, measured from it.
    await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
    await addDish(page, "burgers", "bg-cheese", []);
    await page.click("#cart-bar");
    await page.click("#cart-next");
    check(/Bouchaib|بوشعيب/.test(await page.textContent("#checkout-site")), `${label}: the checkout names the restaurant`);
    await pick(page, 'input[name="mode"][value="delivery"]');
    await page.waitForSelector("#delivery-map.leaflet-container", { state: "attached", timeout: 8000 });
    await page.waitForTimeout(300);
    const st = await page.textContent("#delivery-status");
    check(/0[,.]\d (km|كلم)/.test(st), `${label}: the position found for the choice is the delivery point, measured from Bouchaib Doukkali ("${st.trim()}")`);
    await page.fill('input[name="name"]', "A");
    await page.fill('input[name="phone"]', "0600000000");
    await page.click("#send-btn");
    const m = await sentMessage(page);
    check(m && m.to === "/212664496296" && /(Bouchaib Doukkali|بوشعيب الدكالي)/.test(m.text) && /35 (DH|درهم)/.test(m.text), `${label}: the order goes to WhatsApp +212664496296, 25 + 10 DH delivery`);
    // Changing restaurant from the checkout moves the delivery area.
    await page.click("#checkout-form [data-change-site]");
    await page.waitForSelector("#site-dialog[open]");
    check(await page.isVisible("#site-close"), `${label}: when changing, the sheet can be closed`);
    await page.click('#site-list [data-site="sidi-moumen"]');
    await page.waitForTimeout(300);
    const far = await page.textContent("#delivery-status");
    check(/3 /.test(far) && (await page.$("#delivery-status.is-error")), `${label}: from Sidi Moumen the same point is too far ("${far.trim().slice(0, 50)}…")`);
    check((await page.$eval("#ig-float", (a) => a.href)) === "https://www.instagram.com/chicken__amine__1/", `${label}: the Instagram button follows: @chicken__amine__1`);
    // Next visit: no question.
    await page.reload();
    await waitIntro(page);
    await page.waitForTimeout(300);
    check(!(await page.$("#site-dialog[open]")) && (await page.evaluate(() => window.__chickenAmine.site())) === "sidi-moumen", `${label}: on the next visit the remembered restaurant is used without asking`);
    check(errors.length === 0, `${label}: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
    await context.close();
  }

  // The couscous: Friday 12:00 – 17:00 only.
  console.log("\ncouscous on Fridays");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr" });
    await waitIntro(page);
    await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
    await openCat(page, "couscous");
    const wed = await page.evaluate(() => ({ off: document.querySelector('.item[data-item="cs-poulet"] [data-add]').disabled, note: document.querySelector(".category__note").textContent }));
    check(wed.off && /Vendredi uniquement, 12:00 – 17:00/.test(wed.note), `couscous cannot be added on a Wednesday (« ${wed.note} »)`);
    await context.close();
  }
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "ar", time: FRIDAY_LUNCH });
    await waitIntro(page);
    await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
    await openCat(page, "couscous");
    check(!(await page.isDisabled('.item[data-item="cs-viande"] [data-add]')), "couscous can be added on Friday at 14:00");
    await page.click('.item[data-item="cs-viande"] [data-add]');
    await page.waitForTimeout(200);
    check(!(await page.$("#sauce-dialog[open]")), "no sauce sheet for the couscous");
    // Still in the cart after 17:00: the order is held back.
    await page.clock.setFixedTime(FRIDAY_EVENING);
    await page.click("#cart-bar");
    await page.click("#cart-next");
    await page.fill('input[name="name"]', "A");
    await page.fill('input[name="phone"]', "0600000000");
    await page.click("#send-btn");
    const err = await page.textContent("#checkout-error");
    check(!(await sentMessage(page)) && /الجمعة/.test(err), `couscous left in the order after 17:00 is not sent ("${err.trim()}")`);
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // Review page.
  console.log("\nreview pages");
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr" });
    // The review forms are on Google: stop there and only note where each page goes.
    const sent = [];
    await page.route("https://search.google.com/**", (route) => { sent.push(route.request().url()); route.fulfill({ body: "ok", contentType: "text/plain" }); });
    await page.goto(base + "/avis/");
    const choices = await page.$$eval("#choose a", (as) => as.map((a) => a.getAttribute("href")));
    check(choices.join() === "/avis/sidi-moumen/,/avis/bouchaib-doukkali/", `/avis/ asks which restaurant (${choices.join(", ")})`);
    for (const [id, place] of [["sidi-moumen", "ChIJJUTi5A7Npw0RKclHxm17wbo"], ["bouchaib-doukkali", "ChIJG61xOQDNpw0RrRWHPdj3FrM"]]) {
      await page.goto(base + `/avis/${id}/`).catch(() => {});
      await page.waitForTimeout(400);
      check(sent.some((u) => u.includes(`writereview?placeid=${place}`)), `/avis/${id}/ opens that restaurant's Google review form`);
    }
    check(errors.length === 0, "no JavaScript errors");
    await context.close();
  }

  // Each restaurant's own page (the one its Google Business Profile links to).
  console.log("\nrestaurant pages");
  for (const [id, name, phone, address] of [["sidi-moumen", "Chicken Amine", "+212634385931", "Sidi Moumen Al Houda"], ["bouchaib-doukkali", "Chicken Amine 2", "+212664496296", "173 Bd Abou Chouaib Doukkali"]]) {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr", site: null });
    await page.goto(base + `/${id}/`);
    const info = await page.evaluate(() => {
      const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@graph"][0];
      return { h1: document.querySelector("h1").textContent, canonical: document.querySelector('link[rel="canonical"]').href, ld,
        order: document.querySelector(".actions a").getAttribute("href"), text: document.body.textContent,
        wide: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    check(info.ld.name === name && info.ld.telephone === phone && info.ld.address.streetAddress === address && info.ld.openingHoursSpecification[0].closes === "01:00",
      `/${id}/: Google data names « ${info.ld.name} », ${info.ld.telephone}, « ${info.ld.address.streetAddress} », open until 01:00`);
    check(info.h1.startsWith(name) && info.canonical.endsWith(`/${id}/`) && info.text.includes(address) && !info.wide, `/${id}/: title « ${info.h1} », own canonical address, fits a phone`);
    // Its order button opens the menu with that restaurant already chosen, without asking.
    await page.click(".actions a");
    await page.waitForFunction(() => document.querySelector("#intro").classList.contains("is-done"), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ site: window.__chickenAmine.site(), asked: !!document.querySelector("#site-dialog[open]"), search: location.search, hash: location.hash }));
    check(info.order === `/?restaurant=${id}#menu` && after.site === id && !after.asked && after.search === "" && after.hash === "#menu",
      `/${id}/: « Commander » opens the menu for that restaurant without asking (address tidied to ${after.hash})`);
    check(errors.length === 0, `/${id}/: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
    await context.close();
  }

  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
