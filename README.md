# CHICKEN AMINE

One-page website for Chicken Amine, a fast-food restaurant in Sidi Moumen Al Houda, Casablanca.
Plain HTML, CSS and JavaScript with no build step, hosted on Vercel from this repository.

- French (default) and Arabic (right-to-left, at `/?lang=ar`) with a language toggle
- Full menu with prices in MAD, a sticky category bar, a photo (or placeholder illustration) per category
- Cart saved in the browser, then pickup or delivery (Leaflet map, 3 km, 30 DH), and the order is sent on WhatsApp
- Open/closed status in Casablanca time, Google map, phone, Instagram
- `/avis/` forwards the table cards' QR code to the Google review link

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Where to edit things

| What | File |
| --- | --- |
| Phone, WhatsApp, hours, address, map position, delivery fee and range, review link, hero video, site address | `js/config.js` |
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

86 dishes have a photo (from the restaurant's Yassir listing, in `assets/photos/<dish id>.webp`, 600 × 450),
and each category uses one as its cover (`cat-<category>.webp`). A dish without one shows its emoji on a tile: put a square photo (about 320 × 320) in
`assets/photos/` and set the dish's `image` in `js/menu-data.js`, e.g. `image: "assets/photos/tacos-mixte.jpg"`.

### Hero video

The current clip (`assets/video/`) is the watermarked iStock preview 1921631984, a stand-in that is not
licensed for the live site: replace it with the licensed download or the restaurant's own footage.

Put the video in `assets/video/` and set `heroVideo` in `js/config.js`
(`mp4`, optional `webm`, and a `poster` image shown before it plays and when motion is reduced).

## After changing the details or the menu

```sh
node tools/build-seo.js       # schema.org data in index.html, sitemap.xml, robots.txt, head tags
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
