# Google Business Profile: setup guide for Chicken Amine

The listings on Google Maps are where most local customers find the restaurants. There are two, one per
restaurant; each links to its own page of the site. This guide covers what to fill in, in the order to do it.
Open a profile at <https://business.google.com> with an account that manages it (owner or manager).

> In October 2026 "Chicken Amine 2" was **not claimed** ("Revendiquer cet établissement"): the owner should
> claim it first, then add the site's manager as **Gestionnaire**. "Chicken Amine" had `superesto.ma` as its
> website: replace it with the link below.

## 1. Name, categories, contact

| Field | Chicken Amine (Sidi Moumen) | Chicken Amine 2 (Bouchaib Doukkali) |
| --- | --- | --- |
| Name | Chicken Amine | Chicken Amine 2 |
| Phone | 06 34 38 59 31 | 06 64 49 62 96 |
| Address | Sidi Moumen Al Houda, Casablanca | 173 Bd Abou Chouaib Doukkali, Casablanca 20320 |
| Hours | Every day 12:00 – 01:00 | Every day 12:00 – 01:00 |
| Website | https://chickenamine.ma/sidi-moumen/ | https://chickenamine.ma/bouchaib-doukkali/ |
| Menu link | https://chickenamine.ma/?restaurant=sidi-moumen#menu | https://chickenamine.ma/?restaurant=bouchaib-doukkali#menu |
| Order link ("Commander") | same as the menu link | same as the menu link |

- Primary category: Restaurant de restauration rapide (Fast food restaurant). Secondary: Restaurant de
  poulet, Restaurant de tacos, Pizzeria, Sandwicherie, Restaurant de hamburgers.
- Names: the real sign name only; no keywords like "tacos Casablanca" (Google suspends listings for that).
- The site writes the names, addresses and phones exactly as above (`googleName`, `address`, `phone` in
  `js/config.js`): keep both the same, Google compares them. Check each pin is on the shop front.

## 2. Description (750 characters max)

Keep it factual. A starting point:

> Chicken Amine, restaurant de restauration rapide à Sidi Moumen Al Houda, Casablanca. Tacos et tacos
> gratinés, broasters, crunchy's, chawarmas, burgers, paninis, pizzas, pâtes, pasticcios, plats et jus
> frais. Ouvert tous les jours de 12h à 1h du matin. Sur place, à emporter ou en livraison ; commande sur
> WhatsApp depuis notre site.

(For Chicken Amine 2, the same with "boulevard Abou Chouaib Doukkali".)

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

## 5. Review links and table cards

1. Each restaurant has its own review page: `/avis/sidi-moumen/` and `/avis/bouchaib-doukkali/` open its
   Google review form directly (built from the listing's Place ID, `placeId` in `js/config.js`).
   `/avis/` asks which restaurant (cards printed earlier point there).
2. Print the table cards `print/table-card.pdf` (A6, 105 × 148 mm, one page per restaurant): each QR code
   opens that restaurant's review page. Put each card in its own restaurant.
3. Reply to every review, good or bad, within a few days.

After changing the restaurants' details or the site address in `js/config.js`, run
`node tools/build-seo.js`, `node tools/build-locations.js` and `python3 tools/table-card.py`.

## 6. Keep it alive

- Post an update (new dish, offer, Ramadan hours) at least every two weeks.
- Answer the questions in the "Questions & réponses" section.
- Keep the hours and the menu prices in line with the site.
