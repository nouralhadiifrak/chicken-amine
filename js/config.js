/* Restaurant details used across the site. */
window.CONFIG = {
  name: "Chicken Amine",
  // Public address of the site, used for canonical links, the sitemap, share previews and the table-card QR code.
  // No domain yet: this is the Vercel address. Change it here when the domain is bought.
  siteUrl: "https://chicken-amine-theta.vercel.app",
  phone: "0634235350",
  phoneIntl: "+212634235350",
  // WhatsApp number in international format, digits only (orders are sent here).
  whatsapp: "212634235350",
  instagram: "https://www.instagram.com/chicken__amine__1/",
  instagramHandle: "@chicken__amine__1",
  // Google review link, from Google Business Profile > "Ask for reviews" (e.g. "https://g.page/r/XXXX/review").
  // The table cards' QR code opens /avis, which forwards here. Empty = a "coming soon" page.
  googleReviewUrl: "",
  // The Google Business Profile listing ("Voir la localisation" and "Itinéraire" open it).
  googleMapsUrl: "https://share.google/GEj7spYMAm6NMEYuv",
  // Search used by the embedded map so it shows the listing's own pin.
  googleMapsQuery: "Chicken Amine, Sidi Moumen, Casablanca",
  address: {
    fr: "Sidi Moumen Al Houda, Casablanca 22500",
    ar: "سيدي مومن الهدى، الدار البيضاء 22500",
  },
  neighbourhood: { fr: "Sidi Moumen", ar: "سيدي مومن" },
  postalCode: "22500",
  // Restaurant position, used for the delivery distance. APPROXIMATE (Al Houda, Sidi Moumen):
  // replace with the listing's exact pin (Google Maps > long-press the pin > copy the coordinates).
  location: { lat: 33.582355, lng: -7.524371 },
  // Same hours every day, 24h format, Casablanca time. A close at or before open means after midnight.
  hours: { open: "12:00", close: "00:00" },
  timeZone: "Africa/Casablanca",
  currency: { fr: "DH", ar: "درهم" },
  // Delivery: flat fee in MAD and maximum straight-line distance from the restaurant.
  delivery: { fee: 30, maxKm: 3 },
  // The hero video: the turning plate with flying fries on a dark background (720x760; MP4, WebM, poster).
  plateVideo: { mp4: "/assets/video/hero-plate.mp4", webm: "/assets/video/hero-plate.webm", poster: "/assets/video/hero-plate-poster.jpg" },
  // Share-preview image (a food photo once available).
  shareImage: "assets/logo-1200.png",
};
