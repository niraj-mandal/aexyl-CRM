/**
 * Cold call script for one gym, filled only from facts already on the lead (name, city,
 * Google rating/reviews and web presence from the import notes). Nothing is invented:
 * when a fact is missing, that line falls back to a generic version.
 */
export type ScriptSection = { title: string; lines: string[] };

export function parseReviews(notes: string | null | undefined): { rating: number; reviews: number } | null {
  const rating = notes?.match(/(\d(?:\.\d+)?)\s*★/)?.[1];
  const reviews = notes?.match(/(\d+)\s+(?:Google\s+)?reviews/i)?.[1] ?? notes?.match(/Google reviews:\s*(\d+)/i)?.[1];
  return rating && reviews ? { rating: Number(rating), reviews: Number(reviews) } : null;
}

export function buildCallScript(lead: { businessName: string; city: string | null; notes: string | null }): ScriptSection[] {
  const gym = lead.businessName;
  const city = lead.city && lead.city !== "Unknown" ? lead.city : "aapke area";
  const r = parseReviews(lead.notes);
  const site = /business\.site/i.test(lead.notes ?? "") ? "googleSite" : /facebook|instagram/i.test(lead.notes ?? "") ? "social" : "none";

  const compliment =
    r && r.reviews >= 10 && r.rating >= 4
      ? `Main aapki gym ke Google reviews dekh raha tha: ${r.rating} rating, ${r.reviews} reviews. Bahut badhiya kaam kar rahe ho aap.`
      : `Main ${city} ke gyms dekh raha tha aur aapki gym ki Google listing dekhi.`;
  const problem = {
    googleSite: `Aapki purani Google wali free site (business.site) Google ne band kar di hai, toh ab online aapki koi website hi nahi dikhti.`,
    social: `Aapka Facebook/Instagram page hai, par koi website nahi hai. Google pe 'gym near me' search mein page rank nahi karta.`,
    none: `Aapki gym ki koi website nahi hai.`,
  }[site];

  return [
    {
      title: "Opener",
      lines: [
        `"Sat Sri Akal ji! Main [your name] bol raha hoon, AEXYL se. Kya meri baat ${gym} ke owner se ho rahi hai?"`,
        `"Ji, sirf 30 second loonga. ${compliment}"`,
        `Staff picks up: "Owner sahab kab milenge? Unki Google listing ke baare mein baat karni thi." Get their name and number.`,
      ],
    },
    {
      title: "Hook",
      lines: [
        `"Ek cheez notice ki. Jab koi ${city} mein 'gym near me' search karta hai, toh [nearby gym with a website] ki website aati hai, photos, fees, timings sab ke saath. ${problem} Toh naya banda compare karke wahan chala jaata hai."`,
        `Pause. Let them answer.`,
      ],
    },
    {
      title: "Question",
      lines: [
        `"Abhi naye members aapke paas kaise aate hain? Zyada word-of-mouth se, ya Google/Instagram se bhi?"`,
        `Word of mouth → "Matlab jo log aapko jaante hi nahi, woh aap tak pahunch hi nahi rahe. Wahi gap hum bharte hain."`,
        `Instagram → "Instagram pe log scroll karte hain. Google pe log gym dhoondh rahe hote hain, join karne ke liye ready. Dono chahiye."`,
      ],
    },
    {
      title: "Offer",
      lines: [
        `"Main ${gym} ki ek free demo website bana ke dikhata hoon${r && r.reviews >= 10 ? `, aapke ${r.reviews} reviews` : ""}, photos, timings aur WhatsApp button ke saath. Pasand aaye toh baat karenge, nahi toh koi baat nahi."`,
      ],
    },
    {
      title: "Close",
      lines: [
        `"Main aaj hi demo bana ke aapko WhatsApp pe bhej deta hoon. Yeh number WhatsApp pe hai na?"`,
        `"Kal [11 baje] 5 minute call kar loon, demo pe aapka feedback lene ke liye?" Never hang up without a next step.`,
      ],
    },
    {
      title: "Objections",
      lines: [
        `"Gym already full hai" → "Phir website aapki premium image hai. Aur jab koi member chhodta hai, naya kahan se aayega? Website 24 ghante leads laati hai."`,
        `"Kitna kharcha hai?" → "Pehle demo dekh lijiye. Pasand nahi aaya toh price ki baat hi nahi. Pasand aaya toh options dunga."`,
        `"Busy hoon" → "Bilkul. Demo WhatsApp pe bhej doon? Free time mein dekh lena."`,
        `"Soch ke batata hoon" → "Demo dekhe bina sochna mushkil hai. Bhej deta hoon, kal call karoon ya parson?"`,
        `"Beta/bhatija bana dega" → "Achhi baat! Demo bhej deta hoon, unhe bhi idea mil jaayega. Pasand aaye toh ready-made de denge."`,
      ],
    },
  ];
}
