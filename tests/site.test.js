/*
 * End-to-end checks in headless Chromium (Playwright).
 *   npx playwright test is not needed: run with  node tests/site.test.js
 *   (or against a deployed copy:  BASE=https://chicken-amine.pages.dev node tests/site.test.js)
 * Serves the site on a local port, then checks phone (390 px) and desktop widths, in French and Arabic:
 * language/SEO tags, the intro, the header, category tiles and the category view, emojis and the
 * sauce sheet, pickup and delivery orders sent to WhatsApp, the closed-hours warning, sizes/sauces/per-piece support, reduced motion and JS errors,
 * the choice between the two restaurants (each with its own WhatsApp, Instagram, phone and delivery area), the Friday-only couscous,
 * and the demo of online orders (/demo/ and the staff screen /commandes/, with Supabase faked).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const TYPES = { ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

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
  // BASE=https://… runs the same checks against a deployed copy instead of a local server.
  const srv = process.env.BASE ? null : await serve();
  const base = process.env.BASE ? process.env.BASE.replace(/\/$/, "") : `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const sizes = [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 860 }];

  for (const s of sizes) {
    for (const lang of ["fr", "ar"]) {
      const label = `${s.name} ${lang}`;
      console.log(`\n${label}`);
      const { page, context, errors } = await newPage(browser, base, { ...s, lang });

      // Intro (about 1.8 s), then the hero title: plain text in its script font, with no writing animation or mask
      // (the mask used to cut the tails of the capitals' swashes).
      const t0 = await page.evaluate(() => performance.now());
      await waitIntro(page);
      const introMs = Math.round(await page.evaluate(() => performance.now()) - t0);
      const sign = await page.$eval(".hero__title", (h) => {
        const masked = [h, ...h.querySelectorAll("*")].some((e) => { const cs = getComputedStyle(e); return (cs.maskImage || cs.webkitMaskImage || "none") !== "none" || cs.animationName !== "none"; });
        return { masked, children: h.children.length, visible: getComputedStyle(h).visibility === "visible", split: h.querySelectorAll(".st-unit").length,
          font: getComputedStyle(h).fontFamily, text: h.textContent.trim(), left: h.getBoundingClientRect().left };
      });
      const wantFont = lang === "ar" ? /Aref Ruqaa/ : /Great Vibes/;
      check(introMs < 3000, `${label}: the intro is over in ~${introMs} ms`);
      check(sign.visible && !sign.masked && sign.children === 0 && sign.split === 0 && wantFont.test(sign.font) && sign.left >= 0,
        `${label}: « ${sign.text} » shows as plain text in ${sign.font.split(",")[0]}, no writing animation or mask cutting its letters`);
      check(lang === "ar" ? /الأطباق/.test(sign.text) : /Les meilleurs plats à Casablanca/.test(sign.text), `${label}: hero keeps only the title and the buttons`);
      const headerLogo = await page.$eval("#header-logo", (i) => getComputedStyle(i).opacity);
      check(headerLogo === "1", `${label}: logo has glided into the header`);
      const layers = await page.$$eval(".intro__layer", (ls) => ls.map((l) => [l.classList[1].replace("intro__", ""), l.naturalWidth > 0, getComputedStyle(l).opacity]));
      check(layers.length === 4 && layers.every(([, ok, op]) => ok && op === "1"), `${label}: intro built the logo from its layers (${layers.map(([n]) => n).join(", ")})`);
      const video = await page.$eval("#hero-plate video", (v) => ({ src: v.currentSrc.split("/").pop(), paused: v.paused, poster: !!v.poster })).catch(() => null);
      check(video && /^hero-plate(-480)?\.(webm|mp4)$/.test(video.src) && !video.paused && video.poster, `${label}: the plate turns in the hero (${video && video.src})`);
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
      // Chicken Tacos Amine: always tacos poulet; the pâtes sauce and the sauces are chosen first.
      await openCat(page, "plats");
      await page.click('.item[data-item="pl-tacos-amine"] [data-add]');
      await page.click("#options-dialog .icon-btn");
      await page.waitForTimeout(300);
      check(await page.evaluate(() => !JSON.parse(localStorage.getItem("chickenamine.cart.v1")).some((l) => l.id === "pl-tacos-amine")), `${label}: closing the options sheet with ✕ adds nothing`);
      await page.click('.item[data-item="pl-tacos-amine"] [data-add]');
      const tacosChoices = await page.$$eval('#options-body input[name^="opt-"]', (b) => [...new Set(b.map((x) => x.name))].join());
      check(tacosChoices === "opt-pates" && await page.isVisible('#options-body input[name="sauce"]'), `${label}: Chicken Tacos Amine asks only the pâtes sauce (no tacos choice) and the sauces`);
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
      const pickupOk = m1 && /(Sidi Moumen|سيدي مومن)/.test(m1.text) && /(Pepsi|بيبسي)/.test(m1.text) && /(Algérienne, Andalouse|جزائرية، أندلسية)/.test(m1.text) && /132/.test(m1.text) && /Sans oignon/.test(m1.text) && !/(Nuggets|ناجتس)/.test(m1.text) && /(Sauce blanche|الصلصة البيضاء)/.test(m1.text) && !/10 (DH|درهم)/.test(m1.text);
      check(pickupOk, `${label}: pickup message names the restaurant, has items, sauces, soda brand, the pâtes choice (no tacos choice), notes, total 132 and no delivery fee`);

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
      const heroShown = await page.$eval(".hero__title", (h) => h.textContent.trim().length > 0 && getComputedStyle(h).visibility === "visible");
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
    // The Google map loads when the customer scrolls near it.
    await page.evaluate(() => document.querySelector("#infos").scrollIntoView());
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
  // Installing as an app (PWA): manifest, the Android prompt behind our buttons, the iPhone steps, offline.
  console.log("\ninstall as an app");
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "site.webmanifest"), "utf8"));
    const icons = manifest.icons.map((i) => i.purpose + ":" + i.sizes).join();
    check(manifest.display === "standalone" && manifest.name === "Chicken Amine" && manifest.start_url === "/" && /maskable:512x512/.test(icons) && /any:192x192/.test(icons)
      && manifest.icons.every((i) => fs.existsSync(path.join(ROOT, i.src))) && manifest.shortcuts.length === 2,
      `manifest: full-screen app « ${manifest.name} », icons (${icons}), ${manifest.shortcuts.length} shortcuts`);

    // Android: the browser's install prompt is kept and shown from our buttons.
    for (const width of [390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: "block" });
      await presetSite(context);
      await context.addInitScript(() => {
        window.__prompted = 0;
        addEventListener("load", () => setTimeout(() => {
          const e = new Event("beforeinstallprompt", { cancelable: true });
          e.prompt = () => { window.__prompted++; };
          e.userChoice = Promise.resolve({ outcome: "accepted" });
          dispatchEvent(e);
        }, 200));
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/");
      await waitIntro(page);
      await page.waitForTimeout(500);
      const head = await page.evaluate(() => {
        const name = document.querySelector("#site-btn-name");
        return { btn: !document.querySelector("#install-btn").hidden, banner: !document.querySelector("#install-banner").hidden,
          fits: document.querySelector(".header__inner").scrollWidth <= innerWidth + 1 && name.scrollHeight <= name.clientHeight + 3 };
      });
      check(head.btn && !head.banner && head.fits, `${width} px: the install button is in the header, no banner yet, the header still fits`);
      if (width === 390) {
        await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
        await page.click('.cat-tile[data-open-cat="burgers"]');
        await page.waitForSelector("#install-banner:not([hidden])", { timeout: 4000 }).catch(() => {});
        check(await page.isVisible("#install-banner"), "after a category is opened, the banner invites to install");
        await page.click("#install-banner-btn");
        await page.waitForTimeout(200);
        check(await page.evaluate(() => window.__prompted) === 1 && !(await page.isVisible("#install-banner")), "« Installer » opens the phone's install prompt and the banner goes");
        // « Plus tard » is remembered.
        await page.evaluate(() => { localStorage.removeItem("chickenamine.install-later.v1"); });
      }
      if (width === 360) {
        // Without opening anything, the banner comes by itself after 10 seconds.
        await page.waitForSelector("#install-banner:not([hidden])", { timeout: 11000 }).catch(() => {});
        check(await page.isVisible("#install-banner"), "the banner also comes by itself after 10 seconds");
      }
      check(errors.length === 0, `${width} px: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
      await context.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: "block" });
      await presetSite(context);
      await context.addInitScript(() => addEventListener("load", () => setTimeout(() => {
        const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = () => {}; dispatchEvent(e);
      }, 200)));
      const page = await context.newPage();
      await page.goto(base + "/");
      await waitIntro(page);
      await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
      await page.click('.cat-tile[data-open-cat="burgers"]');
      await page.waitForSelector("#install-banner:not([hidden])", { timeout: 4000 }).catch(() => {});
      await page.click("#install-close");
      await page.goto(base + "/");
      await waitIntro(page);
      await page.evaluate(() => document.querySelector("#menu").scrollIntoView());
      await page.click('.cat-tile[data-open-cat="pizzas"]');
      await page.waitForTimeout(2200);
      check(!(await page.isVisible("#install-banner")) && await page.isVisible("#install-btn"), "after « Plus tard » the banner stays away (the header button remains)");
      await context.close();
    }
    // iPhone: no install prompt in Safari, so the button shows the steps.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
      await presetSite(context);
      const page = await context.newPage();
      await page.goto(base + "/?lang=ar");
      await waitIntro(page);
      await page.click("#install-btn");
      await page.waitForTimeout(300);
      check(!!(await page.$("#ios-dialog[open]")) && (await page.$$eval(".ios-steps li", (l) => l.length)) === 3 && /iPhone/.test(await page.textContent("#ios-title")),
        "iPhone: the install button shows the 3 Safari steps (in Arabic too)");
      await context.close();
    }
    // A computer browser that cannot install: nothing is shown.
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: "block" });
      await presetSite(context);
      const page = await context.newPage();
      await page.goto(base + "/");
      await waitIntro(page);
      check(!(await page.isVisible("#install-btn")) && !(await page.isVisible("#install-banner")), "where installing is not possible, no button and no banner");
      await context.close();
    }
    // The saved copy: after one visit, the app opens without a connection.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await presetSite(context);
      const page = await context.newPage();
      await page.goto(base + "/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForTimeout(1500);
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector(".cat-tile", { timeout: 8000 }).catch(() => {});
      const off = await page.evaluate(() => ({ tiles: document.querySelectorAll(".cat-tile").length, photos: [...document.querySelectorAll(".cat-tile img")].filter((i) => i.complete && i.naturalWidth).length }));
      check(off.tiles === 14 && off.photos > 0, `offline after a first visit: the menu still opens (${off.tiles} categories, ${off.photos} photos)`);
      await context.close();
    }
  }

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

  // Online orders (demo): the customer orders from /demo/ and follows the status; the staff screen answers.
  // Supabase is faked here (REST, sign-in and the live channel); the real project is never touched.
  console.log("\nonline orders (demo)");
  const SUPA = "https://azaimbixispnrwwnuwta.supabase.co";
  {
    // The real site still orders on WhatsApp.
    const { page, context } = await newPage(browser, base, { width: 390, height: 844, lang: "fr" });
    await waitIntro(page);
    await addDish(page, "burgers", "bg-cheese", []);
    await page.click("#cart-bar");
    await page.click("#cart-next");
    check(await page.isVisible("#send-btn") && !(await page.isVisible("#order-send")) && !(await page.isVisible("#demo-notice")), "without /demo/: the order still goes to WhatsApp");
    await context.close();
  }
  {
    const { page, context, errors } = await newPage(browser, base, { width: 390, height: 844, lang: "fr" });
    const posted = [];
    let row = { status: "new", eta_minutes: null, accepted_at: null, refuse_reason: null };
    await page.route(SUPA + "/rest/v1/orders**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        posted.push({ body: JSON.parse(req.postData()), prefer: req.headers()["prefer"], key: req.headers()["apikey"] });
        return route.fulfill({ status: 201, body: "" });
      }
      const ok = posted.length && req.headers()["x-order-token"] === posted[0].body.token;
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ok ? [row] : []) });
    });
    await page.goto(base + "/demo/");
    await waitIntro(page);
    check(await page.evaluate(() => location.pathname === "/" && location.search === ""), "/demo/ opens the site in demo mode, address tidied to /");
    await addDish(page, "burgers", "bg-cheese", []);
    await page.click("#cart-bar");
    await page.click("#cart-next");
    check(await page.isVisible("#order-send") && !(await page.isVisible("#send-btn")) && await page.isVisible("#demo-notice"), "demo: « Commander » replaces the WhatsApp button, with a demo notice");
    await page.fill('input[name="name"]', "Test Client");
    await page.fill('input[name="phone"]', "0634235350");
    await page.click("#order-send");
    await page.waitForSelector("#track-dialog[open]", { timeout: 4000 }).catch(() => {});
    const b = (posted[0] || {}).body || {};
    check(posted.length === 1 && posted[0].prefer === "return=minimal" && /^sb_publishable_/.test(posted[0].key) && b.location === "sidi-moumen" && b.mode === "pickup"
      && b.customer_phone === "0634235350" && b.items.length === 1 && b.items[0].qty === 1 && b.total === b.subtotal && b.delivery_fee === 0 && !("status" in b) && /^[0-9a-f-]{36}$/.test(b.token),
      `demo: the order is sent to the restaurant's screen (${b.items && b.items[0].name}, ${b.total} DH), without a status of its own`);
    const sent = await page.evaluate(() => ({ cart: document.querySelector("#cart-bar").hidden, bar: !document.querySelector("#track-bar").hidden, text: document.querySelector("#track-status").textContent }));
    check(sent.cart && sent.bar && /attente/.test(sent.text), `demo: cart emptied, status followed (« ${sent.text} »)`);
    // The restaurant accepts with 20 minutes; the next check (every 4 s) shows it.
    row = { status: "accepted", eta_minutes: 20, accepted_at: OPEN_TIME.toISOString(), refuse_reason: null };
    await page.waitForFunction(() => /20 min/.test(document.querySelector("#track-status").textContent), null, { timeout: 7000 }).catch(() => {});
    check(/Prête dans environ 20 min/.test(await page.textContent("#track-status")) && await page.isVisible("#track-call"), "demo: accepted, « prête dans environ 20 min », with a button to call");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/demo-track.png` });
    // Followed after a reload, then refused with a reason.
    await page.reload();
    row = { status: "refused", eta_minutes: null, accepted_at: null, refuse_reason: "trop de commandes en ce moment" };
    await page.waitForFunction(() => !document.querySelector("#track-bar").hidden, null, { timeout: 5000 }).catch(() => {});
    await page.click("#track-bar");
    await page.waitForFunction(() => /trop de commandes/.test(document.querySelector("#track-status").textContent), null, { timeout: 7000 }).catch(() => {});
    check(/n'a pas pu accepter.*trop de commandes/.test(await page.textContent("#track-status")), "demo: still followed after a reload; a refusal shows its reason");
    await page.click("#track-ok");
    check(await page.evaluate(() => document.querySelector("#track-bar").hidden && !localStorage.getItem("chickenamine.order.v1")), "demo: once seen, a finished order is no longer followed");
    check(errors.length === 0, `demo: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
    await context.close();
  }
  {
    // The staff screen.
    const { page, context, errors } = await newPage(browser, base, { width: 1280, height: 860, lang: "fr" });
    await page.addInitScript(() => {
      // count the rings
      window.__beeps = 0;
      const AC = window.AudioContext;
      window.AudioContext = function () { const a = new AC(); const o = a.createOscillator.bind(a); a.createOscillator = () => { window.__beeps++; return o(); }; return a; };
    });
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(OPEN_TIME.getTime() / 1000) + 3600;
    const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", role: "authenticated", exp, aud: "authenticated" })}.sig`;
    const user = { id: "u1", aud: "authenticated", role: "authenticated", email: "sidi-moumen@test.ma", app_metadata: {}, user_metadata: {} };
    await page.route(SUPA + "/auth/v1/**", (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      if (body.password !== "bon-mot-de-passe") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) });
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r1", user }) });
    });
    const order = (id, min, extra) => ({ id, token: "t", location: "sidi-moumen", created_at: new Date(OPEN_TIME.getTime() - min * 60e3).toISOString(), updated_at: new Date(OPEN_TIME.getTime() - min * 60e3).toISOString(),
      status: "new", eta_minutes: null, accepted_at: null, refuse_reason: null, mode: "pickup", customer_name: "Test Client", customer_phone: "0634235350", address: null, lat: null, lng: null,
      distance_km: null, notes: "Sans oignon", items: [{ name: "Cheese Burger", qty: 2, details: ["Sauce : Algérienne"], size: null, total: 50 }], subtotal: 50, delivery_fee: 0, total: 50, lang: "fr", demo: true, ...extra });
    const db = new Map([["a1b2c3d4-0000-4000-8000-000000000001", order("a1b2c3d4-0000-4000-8000-000000000001", 2)]]);
    const patches = [];
    const reply = (route, rows) => {
      const one = /vnd\.pgrst\.object/.test(route.request().headers()["accept"] || "");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(one ? rows[0] || null : rows) });
    };
    await page.route(SUPA + "/rest/v1/staff**", (route) => reply(route, [{ location: "sidi-moumen" }]));
    await page.route(SUPA + "/rest/v1/orders**", (route) => {
      const req = route.request();
      const id = (new URL(req.url()).searchParams.get("id") || "").replace("eq.", "");
      if (req.method() === "PATCH") {
        const changes = JSON.parse(req.postData());
        patches.push(changes);
        const o = { ...db.get(id), ...changes, updated_at: OPEN_TIME.toISOString() };
        if (changes.status === "accepted") o.accepted_at = OPEN_TIME.toISOString();
        db.set(id, o);
        return reply(route, [o]);
      }
      reply(route, [...db.values()]);
    });
    // The live channel: joins, then delivers one new order.
    let ws = null;
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
      ws = socket;
      socket.onMessage((m) => {
        const msg = JSON.parse(m);
        const arr = Array.isArray(msg);
        const [joinRef, ref, topic, event, payload] = arr ? msg : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload];
        const send = (ev, pl, r = null) => socket.send(JSON.stringify(arr ? [joinRef, r, topic, ev, pl] : { join_ref: joinRef, ref: r, topic, event: ev, payload: pl }));
        if (event === "phx_join") {
          socket.__live = { send };
          send("phx_reply", { status: "ok", response: { postgres_changes: (payload.config.postgres_changes || []).map((c, i) => ({ ...c, id: 100 + i })) } }, ref);
        } else if (event === "heartbeat") send("phx_reply", { status: "ok", response: {} }, ref);
      });
    });
    await page.goto(base + "/commandes/");
    await page.waitForSelector("#login:not([hidden])");
    await page.fill('input[name="email"]', "sidi-moumen@test.ma");
    await page.fill('input[name="password"]', "faux");
    await page.click("#login-btn");
    await page.waitForFunction(() => document.querySelector("#login-error").textContent.length > 0, null, { timeout: 4000 }).catch(() => {});
    check(/incorrect/.test(await page.textContent("#login-error")), "staff screen: a wrong password is refused");
    await page.fill('input[name="password"]', "bon-mot-de-passe");
    await page.click("#login-btn");
    await page.waitForSelector("#start:not([hidden])", { timeout: 4000 }).catch(() => {});
    check(/Sidi Moumen/.test(await page.textContent("#start-place")), "staff screen: the account opens its own restaurant (Sidi Moumen)");
    await page.click("#start-btn");
    await page.waitForSelector("#alert:not([hidden])", { timeout: 4000 }).catch(() => {});
    const a = await page.evaluate(() => ({ title: document.querySelector("#alert-title").textContent, text: document.querySelector("#alert-order").textContent, beeps: window.__beeps, tab: document.title }));
    check(/N° A1B2/.test(a.title) && /2 ×\s*Cheese Burger/.test(a.text) && /Algérienne/.test(a.text) && /Sans oignon/.test(a.text) && /0634235350/.test(a.text) && /50 DH/.test(a.text) && a.beeps > 4 && /^\(1\)/.test(a.tab),
      `staff screen: a waiting order fills the screen and rings (${a.title}, ${a.beeps} tones)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/commandes-alert.png` });
    await page.click('#alert-times [data-eta="20"]');
    await page.waitForSelector("#alert", { state: "hidden", timeout: 4000 }).catch(() => {});
    const card = await page.textContent("#col-accepted").catch(() => "");
    check(patches.length === 1 && patches[0].status === "accepted" && patches[0].eta_minutes === 20 && /Prête dans 20 min/.test(card), "staff screen: accepted with 20 min, moved to « En préparation »");
    const beeps = await page.evaluate(() => window.__beeps);
    await page.waitForTimeout(3000);
    check(await page.evaluate((n) => window.__beeps === n, beeps), "staff screen: the ringing stops once answered");
    await page.click('#col-accepted [data-status="ready"]');
    await page.waitForFunction(() => /Récupérée/.test(document.querySelector("#col-ready").textContent), null, { timeout: 4000 }).catch(() => {});
    check(patches[1] && patches[1].status === "ready", "staff screen: « Prête » moves it on, then « Récupérée » ends a pickup");
    // A new order arrives live.
    const live = order("e5f6a7b8-0000-4000-8000-000000000002", 0, { mode: "delivery", lat: 33.59, lng: -7.52, address: "Rue 12", distance_km: 0.8, delivery_fee: 10, total: 60 });
    db.set(live.id, live);
    check(!!(ws && ws.__live), "staff screen: joined the live channel");
    if (ws && ws.__live) ws.__live.send("postgres_changes", { ids: [100], data: { type: "INSERT", schema: "public", table: "orders", commit_timestamp: OPEN_TIME.toISOString(), errors: null, columns: [], record: live } });
    await page.waitForFunction(() => /E5F6/.test(document.querySelector("#alert-title").textContent) && !document.querySelector("#alert").hidden, null, { timeout: 4000 }).catch(() => {});
    const a2 = await page.textContent("#alert-order");
    check(/Livraison/.test(a2) && /Rue 12/.test(a2) && /Voir sur la carte/.test(a2) && /60 DH/.test(a2), "staff screen: a live delivery order pops up with its address and map link");
    await page.click("#alert-refuse");
    await page.click('#alert-reasons [data-reason="trop de commandes en ce moment"]');
    await page.waitForSelector("#alert", { state: "hidden", timeout: 4000 }).catch(() => {});
    check(patches[2] && patches[2].status === "refused" && patches[2].refuse_reason === "trop de commandes en ce moment" && /Refusée : trop de commandes/.test(await page.textContent("#col-past")),
      "staff screen: refused with a reason, listed with the finished orders");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/commandes.png` });
    check(errors.length === 0, `staff screen: no JavaScript errors${errors.length ? " — " + errors.join(" | ") : ""}`);
    await context.close();
  }

  await browser.close();
  if (srv) srv.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
