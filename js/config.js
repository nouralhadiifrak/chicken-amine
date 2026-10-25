/* Restaurant details used across the site. */
window.CONFIG = {
  name: "Chicken Amine",
  // Public address of the site, used for canonical links, the sitemap, share previews and the table-card QR code.
  // No domain yet: this is the Vercel address. Change it here when the domain is bought.
  siteUrl: "https://chicken-amine-theta.vercel.app",
  // The two restaurants. On the first visit the customer picks one (the nearest, with their GPS); its phone,
  // WhatsApp (orders are sent there), Instagram, map and delivery area are then used everywhere on the site.
  // The first one is the default for search engines and the table card.
  locations: [
    {
      id: "sidi-moumen",
      name: { fr: "Chicken Amine Sidi Moumen", ar: "Chicken Amine سيدي مومن" },
      short: { fr: "Sidi Moumen", ar: "سيدي مومن" },
      phone: "0634385931",
      phoneIntl: "+212634385931",
      // WhatsApp number in international format, digits only.
      whatsapp: "212634385931",
      instagram: "https://www.instagram.com/chicken__amine__1/",
      instagramHandle: "@chicken__amine__1",
      // The Google Maps listing ("Voir la localisation" and "Itinéraire" open it).
      googleMapsUrl: "https://www.google.com/maps/place/chicken+amine/data=!4m2!3m1!1s0xda7cd0ee4e24425:0xbac17b6dc647c929",
      address: {
        fr: "Sidi Moumen Al Houda, Casablanca 22500",
        ar: "سيدي مومن الهدى، الدار البيضاء 22500",
      },
      streetAddress: "Sidi Moumen Al Houda",
      postalCode: "22500",
      // The listing's pin: the embedded map and the delivery distance are measured from here.
      location: { lat: 33.585371, lng: -7.525908 },
    },
    {
      id: "bouchaib-doukkali",
      name: { fr: "Chicken Amine Bouchaib Doukkali", ar: "Chicken Amine بوشعيب الدكالي" },
      short: { fr: "Bouchaib Doukkali", ar: "بوشعيب الدكالي" },
      phone: "0664496296",
      phoneIntl: "+212664496296",
      whatsapp: "212664496296",
      instagram: "https://www.instagram.com/chicken_amine_2/",
      instagramHandle: "@chicken_amine_2",
      googleMapsUrl: "https://www.google.com/maps/place/Chicken+Amine+2/@33.5673126,-7.5893335,629m/data=!3m2!1e3!4b1!4m6!3m5!1s0xda7cd003971ad1b:0xb316f7d83d8715ad!8m2!3d33.5673082!4d-7.5867586!16s%2Fg%2F11myf61r9s",
      address: {
        fr: "Avenue Bouchaib Doukkali, Casablanca",
        ar: "شارع بوشعيب الدكالي، الدار البيضاء",
      },
      streetAddress: "Avenue Bouchaib Doukkali",
      postalCode: "",
      location: { lat: 33.567308, lng: -7.586759 },
    },
  ],
  // Google review link, from Google Business Profile > "Ask for reviews" (e.g. "https://g.page/r/XXXX/review").
  // The table cards' QR code opens /avis, which forwards here. Empty = a "coming soon" page.
  googleReviewUrl: "",
  // Same hours every day at both restaurants, 24h format, Casablanca time. A close at or before open means after midnight.
  hours: { open: "12:00", close: "00:00" },
  timeZone: "Africa/Casablanca",
  currency: { fr: "DH", ar: "درهم" },
  // Delivery, the same at both restaurants: flat fee in MAD and maximum straight-line distance from the restaurant.
  delivery: { fee: 10, maxKm: 3 },
  // The hero video: the turning plate with flying fries on a dark background (720x760; MP4, WebM, poster).
  plateVideo: { mp4: "/assets/video/hero-plate.mp4", webm: "/assets/video/hero-plate.webm", poster: "/assets/video/hero-plate-poster.jpg" },
  // Share-preview image (a food photo once available).
  shareImage: "assets/logo-1200.png",
};
