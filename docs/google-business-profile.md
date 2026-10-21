# Google Business Profile: setup guide for Chicken Amine

The listing on Google Maps is where most local customers find the restaurant. This guide covers what
to fill in, in the order to do it. Open the profile at <https://business.google.com> with the account
that manages the listing (or search "Chicken Amine" on Google while signed in and click "Modifier le profil").

## 1. Name, categories, contact

| Field | Value |
| --- | --- |
| Name | Chicken Amine (the real sign name only; no keywords like "tacos Casablanca", Google suspends listings for that) |
| Primary category | Restaurant de restauration rapide (Fast food restaurant) |
| Secondary categories | Restaurant de poulet (Chicken restaurant), Restaurant de tacos, Pizzeria, Sandwicherie, Restaurant de hamburgers, Bar à jus |
| Phone | 06 34 23 53 50 |
| Website | https://chicken-amine.vercel.app (replace with the domain once bought) |
| Menu link | https://chicken-amine.vercel.app/#menu |
| Order link ("Commander en ligne") | https://chicken-amine.vercel.app/#menu |
| Address | Sidi Moumen Al Houda, Casablanca 22500. Check the pin is exactly on the shop front |
| Hours | Every day 12:00 – 00:00. Add special hours for Ramadan and holidays |

> The phone number on the delivery-platform menu (+212 634-385931) is different from the one on the site.
> Use one number everywhere: Google compares them.

## 2. Description (750 characters max)

Keep it factual. A starting point:

> Chicken Amine, restaurant de restauration rapide à Sidi Moumen Al Houda, Casablanca. Tacos et tacos
> gratinés, broasters, crunchy's, chawarmas, burgers, paninis, pizzas, pâtes, pasticcios, plats et jus
> frais. Ouvert tous les jours de 12h à minuit. Sur place, à emporter ou en livraison ; commande sur
> WhatsApp depuis notre site.

## 3. Attributes

Under "Plus" / "More", tick what is true:

- Service options: dine-in (sur place), takeaway (à emporter), delivery (livraison)
- Offerings: quick bite, kids' menu (Menus Enfants), halal food if applicable
- Payments: cash, and cards only if accepted
- Accessibility and amenities: only what is actually there (wheelchair access, seating, Wi-Fi…)

## 4. Photos

Photos make the biggest difference in clicks. Upload, from a phone in daylight or good light:

- **Logo**: `assets/logo-1200.png` from this site
- **Cover photo**: the best dish shot (a tacos gratiné or a broaster box), landscape
- **Exterior**: shop front from across the street, so people recognise it on arrival
- **Interior**: counter and seating
- **Food**: one clear photo per best seller (tacos, broasters, burgers, pizzas, plats); add 3–5 new ones every month
- **Menu**: a photo of the printed menu, and the menu link above

No stock photos and no text over photos.

## 5. Review link and table cards

1. In the profile, open **"Demander des avis" / "Ask for reviews"** and copy the link (it looks like
   `https://g.page/r/XXXX/review`).
2. Paste it in `js/config.js` as `googleReviewUrl`. The page `/avis/` then forwards to it; until then it
   shows "Bientôt disponible".
3. Print the table card `print/table-card.pdf` (A6, 105 × 148 mm). Its QR code opens `/avis/`, so the
   printed cards keep working even if the review link changes.
4. Reply to every review, good or bad, within a few days.

If the site address changes (new domain), update `siteUrl` in `js/config.js`, then run
`node tools/build-seo.js` and `python3 tools/table-card.py` and print new cards.

## 6. Keep it alive

- Post an update (new dish, offer, Ramadan hours) at least every two weeks.
- Answer the questions in the "Questions & réponses" section.
- Keep the hours and the menu prices in line with the site.
