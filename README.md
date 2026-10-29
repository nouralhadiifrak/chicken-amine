# CHICKEN AMINE

One-page website for Chicken Amine, a fast-food restaurant with two locations in Casablanca: Sidi Moumen Al Houda and Avenue Bouchaib Doukkali.
Plain HTML, CSS and JavaScript with no build step, hosted on Vercel from this repository.

- French (default) and Arabic (right-to-left, at `/?lang=ar`) with a language toggle
- Full menu with prices in MAD, a sticky category bar, a photo (or placeholder illustration) per category
- On the first visit the customer picks a restaurant (the nearest, with their GPS); its phone, WhatsApp, Instagram, map and delivery area are used everywhere
- Cart saved in the browser, then pickup or delivery (Leaflet map, 3 km from the chosen restaurant, 10 DH), and the order is sent to that restaurant's WhatsApp
- Dishes served on some days only (`available`, e.g. the couscous on Fridays 12:00 – 17:00) cannot be ordered outside those hours
- Open/closed status in Casablanca time, Google map, phone, Instagram
- `/avis/` forwards the table cards' QR code to the Google review link

## Domain

The site lives at https://chickenamine.ma (domain at Capconnect: two A records to Vercel for `@`, a CNAME for `www`).
In Vercel, `www.chickenamine.ma` redirects to it, and `vercel.json` redirects the old `chicken-amine-theta.vercel.app`
address to it permanently.

Moving to Cloudflare Pages (free, commercial use allowed): `_headers` holds the same caching rules as
`vercel.json`. Pages settings: production branch `main`, no framework, no build command, output directory `/`.

## Installable app (PWA)

The site installs as an app (home-screen icon, full screen): `site.webmanifest` (name, colours, icons, maskable
icons, shortcuts to order from each restaurant) and `sw.js`, which keeps a copy of the site so the app opens on a
weak or missing connection. Pages, styles and scripts come from the network first (menu and prices stay fresh,
the saved copy only if the network fails or takes over 4 s); photos, icons and fonts from the saved copy, refreshed
in the background. Raise `VERSION` in `sw.js` to drop every saved copy.

Android browsers offer their own install prompt: the site keeps it for its header button and for a banner shown
once the customer has opened a category (or after 10 s; « Plus tard » hides it for two weeks). iPhone Safari has
no prompt, so the same button shows the three Safari steps. Where installing isn't possible, nothing is shown.

## Online orders

Customers order with « Commander »: the order goes to the restaurant's screen, and the customer follows its status
live (sent, accepted with a time, ready, on the way, done, or refused with a reason). WhatsApp is the way out: the
WhatsApp button appears when the order cannot be sent, or when the restaurant has not answered after
`orders.callAfterMinutes` (5) minutes, with the same order already written. (`/demo/`, the old demo address, opens the site.)

**Delivery:** each restaurant has a zone (`js/zones.js`, drawn from the official arrondissement borders and the
owner's sketch); a pin outside it is refused. Inside, the price goes by straight-line distance: 5 DH up to 1.5 km,
10 DH up to 2.5 km, 15 DH beyond (`delivery` in `js/config.js`). The areas are listed on each restaurant's page
(`deliveryAreas` in `js/config.js`, then `node tools/build-locations.js`).

**Staff screen, `/commandes/`**, installable as its own app (« Installer l'app » once signed in; black icon).
Each restaurant signs in with its own account and sees only its own orders; the owner's account sees both.
« Démarrer le service » lets the page ring and keeps the screen awake. Each new order rings and fills the screen
until it is accepted (10/20/30/45 min) or refused. « Envoyer au livreur » opens WhatsApp with the delivery (client,
address, 📍 map position, amount to collect); the staff pick the delivery guy's contact. The « Statistiques » tab
adds up what was collected (finished orders), the best sellers, delivery vs takeaway and the busiest hours, for
today, yesterday, 7 days, this month or last month (a service day runs from 06:00 to 06:00).

**Receipt printer:** on the device the printer is connected to, press « 🖨 Impression auto » (off → 80 mm →
58 mm paper; kept on that device only). Each accepted order then prints its receipt once (even if it was accepted on
another screen), and « Réimprimer » prints it again. Browsers print through their print window; for printing
with no window at all, run Chrome on that computer with `--kiosk-printing` (e.g. a shortcut to
`chrome.exe --kiosk-printing https://chickenamine.ma/commandes/`) and make the receipt printer the default printer.

The orders live in a free Supabase project, `chicken-amine-commandes`; `js/config.js` → `orders` holds its URL and
public key. The tables and access rules are in `supabase/schema.sql`: customers can only add an order and read its
status with its secret token, at most 5 orders per phone in 10 minutes. Accounts are made in Supabase →
Authentication → Users → Add user, then linked in SQL:
`insert into public.staff (user_id, location) values ('<user id>', 'sidi-moumen');` (a restaurant) or
`insert into public.staff (user_id, role) values ('<user id>', 'owner');` (the owner, both restaurants).

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Where to edit things

| What | File |
| --- | --- |
| The two restaurants (phone, WhatsApp, Instagram, address, map link and position), hours, delivery fee and range, review link, hero video, site address | `js/config.js` |
| Menu: dishes, categories, prices, options, sauces, category photos | `js/menu-data.js` |
| Interface text (French / Arabic), page titles and descriptions | `js/i18n.js` |
| Page logic | `js/app.js` |
| Heading animation | `js/spring-text.js` |
| Flying emojis, rolling numbers, cart pop (UI kit) | `js/kit.js` |
| Colours and layout | `css/style.css` |

### Category photos

Each category shows an illustration until it has a photo. Put the photo in `assets/photos/`
(landscape, about 1200 × 570) and set the category's `image` in `js/menu-data.js`:

```js
{ id: "tacos", ..., image: "assets/photos/tacos.jpg", items: [...] }
```

### Sauces and emojis

The sauce list is `SAUCES` in `js/menu-data.js` (`color` is the swatch shown on its pill); after a dish is added the customer may pick up to
`MAX_SAUCES` (2). Sauces are offered with sandwiches, tacos, burgers and fried chicken; a category with `sauces: false`
(salads, pizzas, pasta, sauced plates, drinks, desserts) skips the sauce choice;
an item can override it with its own `sauces: true/false`. The emojis that fly when a dish is added
come from the category's `emoji`, or the item's own `emoji`.

### Dish photos

Only the restaurant's own photos are used (from its Yassir listing, in `assets/photos/<dish id>.webp`, 600 × 450),
and each category uses one as its cover (`cat-<category>.webp`). A dish without one shows its emoji on a tile: put a square photo (about 320 × 320) in
`assets/photos/` and set the dish's `image` in `js/menu-data.js`, e.g. `image: "assets/photos/tacos-mixte.jpg"`.

### Hero video

The hero shows the turning plate with flying fries (`assets/video/hero-plate.webm` / `.mp4`, 720 × 760,
poster `hero-plate-poster.jpg`, set in `plateVideo` in `js/config.js`), cut from the supplied vertical
video without its drawn-in title and buttons; the real title and buttons sit above and below it on
phones, and to its left on PC. The hero background matches the video's dark backdrop.

## Speed on phones

The first screen loads light: the fonts and the delivery map's styles don't hold up the first paint; the hero
shows the plate's still frame (`hero-plate-poster-480.webp` on phones) and fetches the video only once the page
has loaded (a 480 px copy, `hero-plate-480.*`, on phones); category tiles use 480 px copies (`cat-*-480.webp`);
the header logo is `logo-header.webp`; the Google map at the bottom loads when the customer scrolls near it.
After changing a category cover, make its 480 px copy too.

## After changing the code

Raise the `?v=` number on the stylesheet and script links in `index.html` so phones fetch the new files.

## After changing the details or the menu

```sh
node tools/build-seo.js       # schema.org data in index.html, sitemap.xml, robots.txt, head tags
node tools/build-locations.js # each restaurant's page (/sidi-moumen/, /bouchaib-doukkali/) and review links (/avis/)
python3 tools/table-card.py   # table card with its QR code (print/table-card.html and .pdf)
```

The intro builds the logo from four layers in `assets/intro/`; after a logo change, recut them with
`python3 tools/intro-layers.py` (needs `pip install pillow numpy scipy`).

`tools/table-card.py` needs `pip install "qrcode[pil]"` and Chromium.

## Tests

End-to-end checks in headless Chromium, at phone (390 px) and desktop widths, in French and Arabic:
the intro, the header, the category tiles and every category view, flying emojis, the sauce sheet,
pickup and delivery orders, closed hours, options and sauces, reduced motion,
and no JavaScript errors.

```sh
npm install playwright   # once
node tests/site.test.js
```

## Google Business Profile

See [docs/google-business-profile.md](docs/google-business-profile.md).
