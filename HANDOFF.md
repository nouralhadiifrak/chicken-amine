# Handoff: Chicken Amine website

Paste this into a new Claude Code session, or tell it: "Read HANDOFF.md first."

Project: Chicken Amine restaurant website, two locations in Casablanca (Sidi Moumen and Avenue Bouchaib Doukkali).
Repo: nouralhadiifrak/chicken-amine. Work on branch claude/serene-hypatia-bipryk, open a PR for every change, merge only when I say "merge it".
Live: https://chickenamine.ma (domain at Capconnect, DNS pointing to Vercel; www and the old vercel.app address redirect to it). Vercel auto-deploys ~30 s after a merge into main.

Stack: plain HTML/CSS/JS, no framework.
Files: index.html, css/style.css, js/config.js, js/menu-data.js (14 categories, 138 dishes, prices from the October 2026 paper menu), js/i18n.js, js/app.js, js/kit.js, js/spring-text.js.
Languages: French by default, Arabic RTL at /?lang=ar.
Tests: run `node tests/site.test.js` (Playwright, 390 px and 1280 px, FR and AR) and check screenshots before every PR.
After any code change, raise the ?v= number on the CSS/JS links in index.html.

## Built so far

- Intro (about 1.8 s): logo builds from 4 layers, flower grows from its stem, logo glides into the header.
- Hero: dark slate background with a light under the plate.
- Hero title: "Les meilleurs plats à Casablanca" in Great Vibes (Aref Ruqaa in Arabic), plain text (no writing animation).
- Hero has 2 buttons, a turning plate video and 12 floating crumbs.
- Hero layout: phone = title / plate / buttons, PC = text left, plate right.
- If autoplay is blocked, a CSS-turned still image replaces the plate video.
- Torn white paper strip with the categories moving across it.
- Each restaurant has its own page for its Google Business Profile (/sidi-moumen/, /bouchaib-doukkali/, built by tools/build-locations.js) and its own review link (/avis/<id>/); names, addresses and phones match Google exactly. Hours 12:00 – 01:00.
- Installable app (PWA): site.webmanifest + sw.js (offline copy); install button in the header and a banner after browsing (Android prompt, iPhone steps). Next step if wanted: a Google Play version built from it.
- Two restaurants: chosen on the first visit (GPS finds the nearest), remembered, changeable from the header pin. Phone, WhatsApp, Instagram, map and delivery area follow the choice.
- Menu: 14 photo tiles; on phones, dishes are 2-per-row cards. Couscous only on Fridays 12:00 – 17:00.
- Dish photos: only the restaurant's own (Yassir and photos sent by the owner); a dish may reuse a photo of the same kind of dish; dishes without one show emoji tiles. Never use photos from elsewhere. A long press (phone) or a click (PC) shows a dish photo big.
- Plats: each has its description; plats with "pâtes sauce champignon ou blanche" ask for the sauce first (plus the tacos / burger / pasticcio for the Amine plats).
- Ordering: round + buttons; sauces chosen first (max 2), then emojis fly to the cart; soda asks for its brand.
- Cart: rolling numbers, bin icon at quantity 1; pickup or delivery (map with the restaurant's zone, 5/10/15 DH by distance).
- Online orders (official): « Commander » sends the order to the staff screen /commandes/ (Supabase project "chicken-amine-commandes", free plan, schema in supabase/schema.sql); WhatsApp only as the way out (sending fails, or no answer after 5 min). Staff app installable, owner account sees both restaurants, statistics tab, « Envoyer au livreur » via WhatsApp. Delivery zones in js/zones.js, 5/10/15 DH by distance. See README "Online orders". Test orders use the phone 0634235350.

## Important

- The owner's phone is a Huawei with an older browser. It ignores aspect-ratio and :has(), and blocks video autoplay, so keep those fallbacks.
- Ask before guessing what the owner means, and ask for screenshots or videos when something is unclear.

## Still open

- Real sauce list.
- Exact map position.
- Tacos Mixte gratiné price is cut off on the menu scan (set to 40 DH, to confirm).
- Penne Cordon Bleu prices.
- Photos for the dishes that still show an emoji.
- Are the Yassir "Ain Sbaa" photos the same restaurant?
- Plate video may come from Al-Omda.
- Vercel Hobby plan is non-commercial; Pro may be needed.
