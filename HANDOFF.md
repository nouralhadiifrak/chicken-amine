# Handoff: Chicken Amine website

Paste this into a new Claude Code session, or tell it: "Read HANDOFF.md first."

Project: Chicken Amine restaurant website, two locations in Casablanca (Sidi Moumen and Avenue Bouchaib Doukkali).
Repo: nouralhadiifrak/chicken-amine. Work on branch claude/serene-hypatia-bipryk, open a PR for every change, merge only when I say "merge it".
Live: https://chicken-amine-theta.vercel.app (Vercel auto-deploys ~30 s after a merge into main).

Stack: plain HTML/CSS/JS, no framework.
Files: index.html, css/style.css, js/config.js, js/menu-data.js (14 categories, 138 dishes, prices from the October 2026 paper menu), js/i18n.js, js/app.js, js/kit.js, js/spring-text.js.
Languages: French by default, Arabic RTL at /?lang=ar.
Tests: run `node tests/site.test.js` (Playwright, 390 px and 1280 px, FR and AR) and check screenshots before every PR.
After any code change, raise the ?v= number on the CSS/JS links in index.html.

## Built so far

- Intro: logo builds from 4 layers, flower grows from its stem, logo glides into the header.
- Hero: dark slate background with a light under the plate.
- Hero title: "Les meilleurs plats à Casablanca", handwritten in Great Vibes (Aref Ruqaa in Arabic).
- Hero has 2 buttons, a turning plate video and 12 floating crumbs.
- Hero layout: phone = title / plate / buttons, PC = text left, plate right.
- If autoplay is blocked, a CSS-turned still image replaces the plate video.
- Torn white paper strip with the categories moving across it.
- Two restaurants: chosen on the first visit (GPS finds the nearest), remembered, changeable from the header pin. Phone, WhatsApp, Instagram, map and delivery area follow the choice.
- Menu: 14 photo tiles; on phones, dishes are 2-per-row cards. Couscous only on Fridays 12:00 – 17:00.
- Dish photos: only the restaurant's own (Yassir and photos sent by the owner); a dish may reuse a photo of the same kind of dish; dishes without one show emoji tiles. Never use photos from elsewhere. A long press (phone) or a click (PC) shows a dish photo big.
- Plats: each has its description; plats with "pâtes sauce champignon ou blanche" ask for the sauce first (plus the tacos / burger / pasticcio for the Amine plats).
- Ordering: round + buttons; sauces chosen first (max 2), then emojis fly to the cart; soda asks for its brand.
- Cart: rolling numbers, bin icon at quantity 1; WhatsApp order, pickup or delivery (map, 3 km from the chosen restaurant, 10 DH).

## Important

- The owner's phone is a Huawei with an older browser. It ignores aspect-ratio and :has(), and blocks video autoplay, so keep those fallbacks.
- Ask before guessing what the owner means, and ask for screenshots or videos when something is unclear.

## Still open

- Real sauce list.
- Exact map position.
- Tacos Mixte gratiné price is cut off on the menu scan (set to 40 DH, to confirm).
- Penne Cordon Bleu prices.
- Photos for the dishes that still show an emoji (and a couscous cover).
- Are the Yassir "Ain Sbaa" photos the same restaurant?
- Plate video may come from Al-Omda.
- Vercel Hobby plan is non-commercial; Pro may be needed.
- Custom domain.
