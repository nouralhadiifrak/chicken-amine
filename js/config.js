/* Restaurant details used across the site. */
window.CONFIG = {
  name: "Chicken Amine",
  // Public address of the site, used for canonical links, the sitemap, share previews and the table-card QR code.
  siteUrl: "https://chickenamine.ma",
  // The two restaurants. On the first visit the customer picks one (the nearest, with their GPS); its phone,
  // WhatsApp (orders are sent there), Instagram, map and delivery area are then used everywhere on the site.
  // The first one is the default for search engines and the table card.
  locations: [
    {
      id: "sidi-moumen",
      // Name, address and phone written exactly as on the restaurant's Google Business Profile.
      googleName: "Chicken Amine",
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
      // The Google Maps listing's id (Place ID), used for its review link.
      placeId: "ChIJJUTi5A7Npw0RKclHxm17wbo",
      address: {
        fr: "Sidi Moumen Al Houda, Casablanca",
        ar: "سيدي مومن الهدى، الدار البيضاء",
      },
      streetAddress: "Sidi Moumen Al Houda",
      postalCode: "",
      // The listing's pin: the embedded map and the delivery distance are measured from here.
      location: { lat: 33.585371, lng: -7.525908 },
      // Where it delivers (the exact outline is in js/zones.js), as written on its page.
      deliveryAreas: "Sidi Moumen, Al Azhar, Sidi Bernoussi, Aïn Sebaâ, Hay Mohammadi, Moulay Rachid (Bournazel), Sidi Othmane",
    },
    {
      id: "bouchaib-doukkali",
      googleName: "Chicken Amine 2",
      name: { fr: "Chicken Amine 2 Bouchaib Doukkali", ar: "Chicken Amine 2 بوشعيب الدكالي" },
      short: { fr: "Bouchaib Doukkali", ar: "بوشعيب الدكالي" },
      phone: "0664496296",
      phoneIntl: "+212664496296",
      whatsapp: "212664496296",
      instagram: "https://www.instagram.com/chicken_amine_2/",
      instagramHandle: "@chicken_amine_2",
      googleMapsUrl: "https://www.google.com/maps/place/Chicken+Amine+2/@33.5673126,-7.5893335,629m/data=!3m2!1e3!4b1!4m6!3m5!1s0xda7cd003971ad1b:0xb316f7d83d8715ad!8m2!3d33.5673082!4d-7.5867586!16s%2Fg%2F11myf61r9s",
      placeId: "ChIJG61xOQDNpw0RrRWHPdj3FrM",
      address: {
        fr: "173 Bd Abou Chouaib Doukkali, Casablanca 20320",
        ar: "173 شارع أبو شعيب الدكالي، الدار البيضاء 20320",
      },
      streetAddress: "173 Bd Abou Chouaib Doukkali",
      postalCode: "20320",
      location: { lat: 33.567308, lng: -7.586759 },
      deliveryAreas: "Al Fida, Mers Sultan, Maârif, Ben M'Sick, Sbata, Aïn Chock, Sidi Othmane, centre-ville, Roches Noires",
    },
  ],
  // Same hours every day at both restaurants, 24h format, Casablanca time. A close at or before open means after midnight.
  hours: { open: "12:00", close: "01:00" },
  timeZone: "Africa/Casablanca",
  currency: { fr: "DH", ar: "درهم" },
  // Delivery, the same prices at both restaurants, by straight-line distance from the restaurant (MAD): up to 1.5 km,
  // up to 2.5 km, then farFee anywhere else inside the restaurant's delivery zone (js/zones.js).
  delivery: { tiers: [{ upToKm: 1.5, fee: 5 }, { upToKm: 2.5, fee: 10 }], farFee: 15 },
  // The hero video: the turning plate with flying fries on a dark background (720x760; MP4, WebM, poster), and a
  // lighter 480 px copy for phones (smallMp4, smallWebm, smallPoster).
  plateVideo: {
    mp4: "/assets/video/hero-plate.mp4", webm: "/assets/video/hero-plate.webm", poster: "/assets/video/hero-plate-poster.webp",
    smallMp4: "/assets/video/hero-plate-480.mp4", smallWebm: "/assets/video/hero-plate-480.webm", smallPoster: "/assets/video/hero-plate-poster-480.webp",
  },
  // Online orders (demo of the staff order screen, /commandes/): the Supabase project and its publishable key,
  // which is public by design (the database's row level security decides what it can do; see supabase/schema.sql).
  // Orders go there instead of WhatsApp only in demo mode (opened with /demo/); real customers still use WhatsApp.
  orders: {
    supabaseUrl: "https://azaimbixispnrwwnuwta.supabase.co",
    publishableKey: "sb_publishable_NPJc46YnphSCaTFDyY6Uaw_kAT7KWzR",
    // after this many minutes without an answer, the customer is invited to call the restaurant
    callAfterMinutes: 5,
  },
  // Share-preview image (WhatsApp, Facebook): the turning plate and the logo, 1200 x 630.
  shareImage: "assets/share.jpg",
};
