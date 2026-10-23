# Handoff: Chicken Amine website

Paste this into a new Claude Code session, or tell it: "Read HANDOFF.md first."

Project: Chicken Amine restaurant website (Sidi Moumen, Casablanca).
Repo: nouralhadiifrak/chicken-amine. Work on branch claude/serene-hypatia-bipryk, open a PR for every change, merge only when I say "merge it".
Live: https://chicken-amine-theta.vercel.app (Vercel auto-deploys ~30 s after a merge into main).

Stack: plain HTML/CSS/JS, no framework.
Files: index.html, css/style.css, js/config.js, js/menu-data.js (13 categories, 116 dishes), js/i18n.js, js/app.js, js/kit.js, js/spring-text.js.
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
- Menu: 13 photo tiles; on phones, dishes are 2-per-row cards.
- Dish photos: 86 dishes have one (from Yassir), the rest show emoji tiles.
- Ordering: round + buttons; sauces chosen first (max 2), then emojis fly to the cart; soda asks for its brand.
- Cart: rolling numbers, bin icon at quantity 1; WhatsApp order, pickup or delivery (map, 3 km, 30 DH).

## Important

- The owner's phone is a Huawei with an older browser. It ignores aspect-ratio and :has(), and blocks video autoplay, so keep those fallbacks.
- Ask before guessing what the owner means, and ask for screenshots or videos when something is unclear.

## Still open

- Real sauce list.
- Exact map position.
- Correct phone number: 0634235350 or +212 634-385931?
- Penne Cordon Bleu prices.
- Photos for 30 dishes.
- Are the Yassir "Ain Sbaa" photos the same restaurant?
- Plate video may come from Al-Omda.
- Vercel Hobby plan is non-commercial; Pro may be needed.
- Custom domain.
