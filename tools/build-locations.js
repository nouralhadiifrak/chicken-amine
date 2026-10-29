#!/usr/bin/env node
/*
 * Generates, from js/config.js and js/menu-data.js:
 *   - one page per restaurant (/sidi-moumen/, /bouchaib-doukkali/): the page its Google Business Profile links to,
 *     with its own name, address, phone, hours, map, schema.org data and an order button that opens the menu with
 *     that restaurant already chosen
 *   - one review page per restaurant (/avis/<id>/) that forwards to its Google review form, and /avis/, which
 *     asks which restaurant (the table cards printed before had a single QR code)
 * Run after changing the restaurants' details:  node tools/build-locations.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["js/config.js", "js/menu-data.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const C = ctx.window.CONFIG;
const MENU = ctx.window.MENU;
const site = C.siteUrl.replace(/\/$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const phoneText = (p) => p.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
const reviewUrl = (l) => `https://search.google.com/local/writereview?placeid=${l.placeId}`;
const close = C.hours.close === "00:00" ? "minuit" : C.hours.close.replace(/^0/, "").replace(":00", "h");
const closeAr = C.hours.close === "01:00" ? "الواحدة صباحا" : C.hours.close;
const write = (rel, html) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), html);
};

// The look of these small pages: the site's colours and fonts, no script.
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Cairo:wght@600;700&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">`;
const BASE_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; background: #e1060f; color: #1d1d1d; font-family: "Poppins", "Cairo", sans-serif; line-height: 1.5; }
    a { color: #a8040b; }
    .top { background: #fff; padding: 10px 16px; display: flex; justify-content: center; }
    .top img { height: 48px; width: auto; display: block; }
    main { max-width: 820px; margin: 0 auto; padding: 20px 16px 40px; }
    .card { background: #fff; border-radius: 22px; padding: 24px 20px; box-shadow: 0 20px 40px -24px rgba(0,0,0,.6); }
    h1, h2 { font-family: "Baloo 2", sans-serif; color: #e1060f; line-height: 1.15; margin: 0 0 10px; }
    h1 { font-size: 1.9rem; }
    h2 { font-size: 1.3rem; margin-top: 26px; }
    [lang="ar"] { font-family: "Cairo", sans-serif; direction: rtl; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 20px; border-radius: 999px;
      font-family: "Baloo 2", sans-serif; font-weight: 800; font-size: 1.05rem; text-decoration: none; }
    .btn--yellow { background: #fbba00; color: #141414; }
    .btn--red { background: #e1060f; color: #fff; }
    .btn--line { background: #fff; color: #e1060f; border: 2px solid #e1060f; }
    footer { text-align: center; color: #fff; font-size: .9rem; padding: 0 16px 30px; }
    footer a { color: #fff; }`;

function locationPage(l, other) {
  const url = `${site}/${l.id}/`;
  const title = `${l.googleName} · ${l.short.fr}, Casablanca · Tacos, broasters, burgers, pizzas`;
  const desc = `${l.googleName}, restaurant de restauration rapide à ${l.short.fr}, Casablanca (${l.address.fr}). Tacos, broasters, chawarmas, burgers, pizzas et plats. Ouvert tous les jours de 12h à ${close}, sur place, à emporter ou en livraison. ${phoneText(l.phone)}.`;
  const photos = MENU.filter((c) => c.image).slice(0, 8);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Restaurant",
        "@id": `${url}#restaurant`,
        name: l.googleName,
        alternateName: `Chicken Amine ${l.short.fr}`,
        url,
        image: photos.slice(0, 3).map((c) => site + c.image),
        logo: `${site}/assets/logo-1200.png`,
        telephone: l.phoneIntl,
        servesCuisine: ["Fast-food", "Tacos", "Burgers", "Pizza", "Sandwichs"],
        priceRange: "$",
        currenciesAccepted: "MAD",
        address: {
          "@type": "PostalAddress",
          streetAddress: l.streetAddress,
          addressLocality: "Casablanca",
          ...(l.postalCode ? { postalCode: l.postalCode } : {}),
          addressCountry: "MA",
        },
        geo: { "@type": "GeoCoordinates", latitude: l.location.lat, longitude: l.location.lng },
        hasMap: l.googleMapsUrl,
        sameAs: [l.instagram, l.googleMapsUrl],
        openingHoursSpecification: [{
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          opens: C.hours.open,
          closes: C.hours.close,
        }],
        hasMenu: `${site}/#menu`,
        acceptsReservations: false,
        brand: { "@type": "Brand", name: C.name },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: C.name, item: `${site}/` },
          { "@type": "ListItem", position: 2, name: l.short.fr, item: url },
        ],
      },
    ],
  };
  const json = JSON.stringify(schema, null, 2).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- generated by tools/build-locations.js from js/config.js; do not edit by hand -->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#e1060f">
  <meta property="og:type" content="restaurant">
  <meta property="og:site_name" content="${esc(C.name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${site}/${C.shareImage}">
  <meta property="og:locale" content="fr_MA">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
  ${FONTS}
  <script type="application/ld+json">
${json}
  </script>
  <style>${BASE_CSS}
    .lead { margin: 0 0 6px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 6px; }
    .facts { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 10px; }
    .facts li { display: grid; grid-template-columns: 110px 1fr; gap: 10px; padding: 10px 0; border-top: 1px solid #ececec; }
    .facts b { color: #5d5d5d; font-weight: 600; }
    .facts [lang="ar"] { display: block; }
    .map { width: 100%; height: 300px; border: 0; border-radius: 16px; margin-top: 8px; }
    .photos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 8px; }
    .photos figure { margin: 0; }
    .photos img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 14px; display: block; background: #fff4cc; }
    .photos figcaption { font-size: .85rem; color: #5d5d5d; margin-top: 4px; }
    @media (min-width: 640px) { .photos { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <header class="top"><a href="/"><img src="/assets/logo-header.webp" alt="${esc(C.name)}" width="360" height="187"></a></header>
  <main>
    <article class="card">
      <h1>${esc(l.googleName)} · ${esc(l.short.fr)}</h1>
      <p class="lead">Restaurant de restauration rapide à ${esc(l.short.fr)}, Casablanca : tacos et tacos gratinés, broasters, chawarmas, burgers, paninis, pizzas, pâtes et plats. Sur place, à emporter ou en livraison (${esc(l.deliveryAreas)}).</p>
      <p class="lead" lang="ar">مطعم للوجبات السريعة في ${esc(l.short.ar)}، الدار البيضاء: طاكوس، بروستر، شاورما، برغر، بانيني، بيتزا، معكرونة وأطباق. في عين المكان، للأخذ أو التوصيل.</p>
      <div class="actions">
        <a class="btn btn--yellow" href="/?restaurant=${l.id}#menu">Commander · اطلب</a>
        <a class="btn btn--red" href="${esc(l.googleMapsUrl)}" target="_blank" rel="noopener">Itinéraire</a>
        <a class="btn btn--line" href="tel:${l.phoneIntl}">Appeler</a>
        <a class="btn btn--line" href="/avis/${l.id}/">Laisser un avis</a>
      </div>
      <ul class="facts">
        <li><b>Adresse</b><span>${esc(l.address.fr)}<br><span lang="ar">${esc(l.address.ar)}</span></span></li>
        <li><b>Horaires</b><span>Tous les jours, ${C.hours.open} – ${C.hours.close}</span></li>
        <li><b>Téléphone</b><span><a href="tel:${l.phoneIntl}" dir="ltr">${phoneText(l.phone)}</a> · <a href="https://wa.me/${l.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></span></li>
        <li><b>Instagram</b><span><a href="${esc(l.instagram)}" target="_blank" rel="noopener">${esc(l.instagramHandle)}</a></span></li>
        <li><b>Livraison</b><span>${C.delivery.tiers.map((x) => `${x.fee} DH jusqu'à ${String(x.upToKm).replace(".", ",")} km`).join(" · ")} · ${C.delivery.farFee} DH au-delà, dans la zone : ${esc(l.deliveryAreas)}</span></li>
      </ul>
      <h2>Plan</h2>
      <iframe class="map" title="Carte : ${esc(l.googleName)} sur Google Maps" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${l.location.lat},${l.location.lng}&amp;z=16&amp;output=embed"></iframe>
      <h2>Notre menu</h2>
      <div class="photos">
${photos.map((c) => `        <figure><a href="/?restaurant=${l.id}#categorie-${c.id}"><img src="${c.image}" alt="${esc(c.fr)} · ${esc(l.googleName)}" width="600" height="450" loading="lazy"></a><figcaption>${esc(c.fr)}</figcaption></figure>`).join("\n")}
      </div>
      <div class="actions"><a class="btn btn--yellow" href="/?restaurant=${l.id}#menu">Voir tout le menu et commander</a></div>
      <h2>Notre autre restaurant</h2>
      <p><a href="/${other.id}/">${esc(other.googleName)} · ${esc(other.short.fr)}</a> : ${esc(other.address.fr)} · <a href="tel:${other.phoneIntl}" dir="ltr">${phoneText(other.phone)}</a></p>
    </article>
  </main>
  <footer><p>© ${new Date().getFullYear()} ${esc(C.name)} · <a href="/">chickenamine.ma</a> · <a href="/confidentialite/">Politique de confidentialité</a></p></footer>
</body>
</html>
`;
}

// Forwards to the restaurant's Google review form.
function reviewPage(l) {
  const target = reviewUrl(l);
  return `<!doctype html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <!-- generated by tools/build-locations.js from js/config.js; do not edit by hand -->
  <title>${esc(l.googleName)} · Avis Google</title>
  <meta http-equiv="refresh" content="0; url=${target}">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family: sans-serif; text-align: center; padding: 40px 16px;">
  <p><a href="${target}">Laisser un avis Google pour ${esc(l.googleName)} · ${esc(l.short.fr)}</a></p>
</body>
</html>
`;
}

// /avis/: the table cards printed before had one QR code for both restaurants, so it asks which one.
function reviewChoice() {
  return `<!doctype html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <!-- generated by tools/build-locations.js from js/config.js; do not edit by hand -->
  <title>${esc(C.name)} · Avis Google</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  ${FONTS}
  <style>${BASE_CSS}
    body { min-height: 100vh; display: grid; place-items: center; padding: 20px 16px; }
    .card { max-width: 420px; width: 100%; text-align: center; }
    .card > img { width: 200px; height: auto; margin: 0 auto 14px; display: block; }
    .choices { display: grid; gap: 12px; margin-top: 18px; }
  </style>
</head>
<body>
  <main class="card" id="choose">
    <img src="/assets/logo-header.webp" alt="${esc(C.name)}" width="360" height="187">
    <h1>Votre avis compte !</h1>
    <p>Dans quel restaurant avez-vous mangé ?</p>
    <p lang="ar">في أي مطعم تناولت وجبتك؟</p>
    <div class="choices">
${C.locations.map((l) => `      <a class="btn btn--yellow" href="/avis/${l.id}/">${esc(l.googleName)} · ${esc(l.short.fr)}</a>`).join("\n")}
    </div>
  </main>
</body>
</html>
`;
}

C.locations.forEach((l, i) => {
  write(`${l.id}/index.html`, locationPage(l, C.locations[(i + 1) % C.locations.length]));
  write(`avis/${l.id}/index.html`, reviewPage(l));
});
write("avis/index.html", reviewChoice());
console.log(`pages: ${C.locations.map((l) => "/" + l.id + "/").join(" ")} · reviews: /avis/ ${C.locations.map((l) => "/avis/" + l.id + "/").join(" ")}`);
