/**
 * Cold call script for one gym, filled only from facts already on the lead (name, city,
 * Google rating/reviews and web presence from the import notes). Nothing is invented:
 * when a fact is missing, that line falls back to a generic version.
 */
export type ScriptSection = { title: string; lines: string[] };

/** The lead fields the scripts read. `area`/`place` (address or "City, State, India") pick the greeting. */
type ScriptLead = { businessName: string; city: string | null; notes: string | null; area?: string | null; place?: string | null };

/**
 * Greeting that fits where the gym is: Punjabi in Punjab, "Pranam" in Bihar (and the
 * Hindi-speaking east), Assamese "Nomoskar" in Assam, "Namaste" anywhere else. Read from the gym's own address.
 */
export function greetingFor(lead: Pick<ScriptLead, "area" | "place">): string {
  const where = `${lead.area ?? ""} ${lead.place ?? ""}`.toLowerCase();
  if (/\bpunjab\b/.test(where)) return "Sat Sri Akal ji";
  if (/\b(bihar|jharkhand)\b/.test(where)) return "Pranam ji";
  if (/\bassam\b/.test(where)) return "Nomoskar";
  return "Namaste ji";
}

/** Script language. Assam gets Assamese (Roman letters, easy to read aloud); a teammate can switch to Hinglish. */
export type ScriptLang = "hinglish" | "assamese";
export const defaultLang = (lead: Pick<ScriptLead, "area" | "place">): ScriptLang =>
  /\bassam\b/i.test(`${lead.area ?? ""} ${lead.place ?? ""}`) ? "assamese" : "hinglish";

export function parseReviews(notes: string | null | undefined): { rating: number; reviews: number } | null {
  const rating = notes?.match(/(\d(?:\.\d+)?)\s*★/)?.[1];
  const reviews = notes?.match(/(\d+)\s+(?:Google\s+)?reviews/i)?.[1] ?? notes?.match(/Google reviews:\s*(\d+)/i)?.[1];
  return rating && reviews ? { rating: Number(rating), reviews: Number(reviews) } : null;
}

/** The name saved in Outreach's preferences, so scripts and messages are signed by you. */
export function senderName(): string {
  try {
    return (JSON.parse(localStorage.getItem("aexyl.pitchWriter.prefs") ?? "{}").senderName as string)?.trim() || "[your name]";
  } catch {
    return "[your name]";
  }
}

export type WhatsAppKind = "intro" | "demo" | "callback" | "noAnswer";
export const WHATSAPP_KINDS: { kind: WhatsAppKind; label: string }[] = [
  { kind: "intro", label: "Intro" },
  { kind: "noAnswer", label: "No answer" },
  { kind: "callback", label: "Callback" },
  { kind: "demo", label: "Send demo" },
];

/** Which message fits where the lead is now. */
export function suggestedWhatsApp(status: string): WhatsAppKind {
  if (status === "QUALIFIED") return "demo";
  if (status === "CONTACTED" || status === "NURTURE") return "callback";
  return "intro";
}

/** WhatsApp text for one situation, from the lead's own facts only. */
export function buildWhatsApp(
  kind: WhatsAppKind,
  lead: ScriptLead,
  name = senderName(),
  demoLink = "[demo link]",
  lang: ScriptLang = defaultLang(lead),
): string {
  if (lang === "assamese") return whatsAppAssamese(kind, lead, name, demoLink);
  const gym = lead.businessName;
  const hello = greetingFor(lead);
  const city = lead.city && lead.city !== "Unknown" ? lead.city : "aapke area";
  const r = parseReviews(lead.notes);
  const praise = r && r.reviews >= 10 && r.rating >= 4 ? ` Aapke ${r.reviews} Google reviews aur ${r.rating} rating dekhi, bahut badhiya!` : "";
  switch (kind) {
    case "intro":
      return `${hello}! Main ${name}, AEXYL se.${praise}\n\n${gym} ki koi website nahi hai, toh ${city} mein Google pe gym dhoondhne wale naye log aap tak nahi pahunch paate.\n\nMain ${gym} ki ek free demo website bana ke dikha sakta hoon. Bhej doon?`;
    case "noAnswer":
      return `${hello}! Main ${name}, AEXYL se. Aapko ${gym} ke baare mein call kiya tha.${praise}\n\nAapki gym ki free demo website bana ke dikhana chahta hoon. Kab baat ho sakti hai?`;
    case "callback":
      return `${hello}! ${name} AEXYL se. ${gym} ki website ke baare mein baat hui thi.\n\nJab free ho, bataiye kab call karoon? 5 minute ka kaam hai.`;
    case "demo":
      return `${hello}! ${name} AEXYL se. Jaisa call pe kaha tha, ${gym} ki demo website:\n\n${demoLink}\n\nDekh ke bataiye kaisi lagi. Kal 5 minute call kar loon aapka feedback lene ke liye?`;
  }
}

export function buildCallScript(lead: ScriptLead, name = senderName(), lang: ScriptLang = defaultLang(lead)): ScriptSection[] {
  if (lang === "assamese") return callScriptAssamese(lead, name);
  const gym = lead.businessName;
  const hello = greetingFor(lead);
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
        `"${hello}! Main ${name} bol raha hoon, AEXYL se. Kya meri baat ${gym} ke owner se ho rahi hai?"`,
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

// --- Assamese (Roman letters) -----------------------------------------------------------
// Same structure and facts as the Hinglish versions above; stage directions stay in English.

const siteOf = (notes: string | null) =>
  /business\.site/i.test(notes ?? "") ? "googleSite" : /facebook|instagram/i.test(notes ?? "") ? "social" : "none";

function whatsAppAssamese(kind: WhatsAppKind, lead: ScriptLead, name: string, demoLink: string): string {
  const gym = lead.businessName;
  const city = lead.city && lead.city !== "Unknown" ? lead.city : "apunar area";
  const r = parseReviews(lead.notes);
  const praise = r && r.reviews >= 10 && r.rating >= 4 ? ` Apunar ${r.reviews} ta Google review aru ${r.rating} rating dekhilu, bor bhal!` : "";
  switch (kind) {
    case "intro":
      return `Nomoskar! Moi ${name}, AEXYL-r pora.${praise}

${gym}-r kunu website nai, gotike ${city}-t Google-t gym bisora notun manuh apunar ocholoi ahibo nuwaare.

Moi ${gym}-r babe eta free demo website bonai dekhuwabo paru. Pothiai dim neki?`;
    case "noAnswer":
      return `Nomoskar! Moi ${name}, AEXYL-r pora. ${gym}-r bisoye apunak phone korisilu.${praise}

Apunar gym-r eta free demo website bonai dekhuwabo bisarisu. Ketiya kotha hobo pare?`;
    case "callback":
      return `Nomoskar! ${name}, AEXYL-r pora. ${gym}-r website-r bisoye kotha hoisil.

Apuni ketiya free thakibo, kobo, tetiya phone korim. 5 minute-r kotha.`;
    case "demo":
      return `Nomoskar! ${name}, AEXYL-r pora. Phone-t koisilu dore, ${gym}-r demo website:

${demoLink}

Sai kobo kene lagil. Kaali 5 minute phone kori apunar motamot lom neki?`;
  }
}

function callScriptAssamese(lead: ScriptLead, name: string): ScriptSection[] {
  const gym = lead.businessName;
  const city = lead.city && lead.city !== "Unknown" ? lead.city : "apunar area";
  const r = parseReviews(lead.notes);
  const compliment =
    r && r.reviews >= 10 && r.rating >= 4
      ? `Moi apunar gym-r Google review bilak saisilu: ${r.rating} rating, ${r.reviews} ta review. Apuni bor bhal kaam kori ase.`
      : `Moi ${city}-r gym bilak saisilu aru apunar gym-r Google listing dekhilu.`;
  const problem = {
    googleSite: `Apunar purona Google-r free site (business.site) Google-e bondho kori dise, gotike etiya online-t apunar kunu website nedekhi.`,
    social: `Apunar Facebook/Instagram page ase, kintu kunu website nai. Google-t 'gym near me' search korile page-tu oporot nahe.`,
    none: `Apunar gym-r kunu website nai.`,
  }[siteOf(lead.notes)];

  return [
    {
      title: "Opener",
      lines: [
        `"Nomoskar! Moi ${name} koisu, AEXYL-r pora. ${gym}-r owner-r logot kotha hoise neki?"`,
        `"Hoi, matro 30 second lom. ${compliment}"`,
        `Staff picks up: "Owner-k ketiya pam? Teor Google listing-r bisoye kotha patibo lagise." Get their name and number.`,
      ],
    },
    {
      title: "Hook",
      lines: [
        `"Eta kotha mon korilu. Jetia kunubai ${city}-t 'gym near me' bisare, [nearby gym with a website]-r website ole, photo, fees, timing sokolu thake. ${problem} Gotike notun manuhjone compare kori tatei jai."`,
        `Pause. Let them answer.`,
      ],
    },
    {
      title: "Question",
      lines: [
        `"Etiya notun member apunar ocholoi kenekoi ahe? Beshi bhag manuhe koi-koi ahe, ne Google/Instagram-r pora o ahe?"`,
        `Word of mouth → "Matlab jibilake apunak nasine, teulok apunar ocholoi ahibo pora nai. Sei gap-tu ami puron kori diu."`,
        `Instagram → "Instagram-t manuhe scroll kore. Google-t manuhe gym bisari thake, join koribole ready hoi. Duyota lage."`,
      ],
    },
    {
      title: "Offer",
      lines: [
        `"Moi ${gym}-r eta free demo website bonai dekhuam${r && r.reviews >= 10 ? `, apunar ${r.reviews} ta review` : ""}, photo, timing aru WhatsApp button-r logot. Bhal lagile kotha patim, nalagile kunu kotha nai."`,
      ],
    },
    {
      title: "Close",
      lines: [
        `"Moi aji-e demo bonai apunak WhatsApp-t pothiai dim. Ei number-tu WhatsApp-t ase nohoi?"`,
        `"Kaali [11 bojat] 5 minute phone kori demo-r bisoye apunar motamot lom neki?" Never hang up without a next step.`,
      ],
    },
    {
      title: "Objections",
      lines: [
        `"Gym already full" → "Tetiya website apunar premium image. Aru jetia kunuba member gusi jai, notun jon kot pora ahibo? Website-e 24 ghanta lead ani diye."`,
        `"Kiman khoros?" → "Prothome demo-tu sai lok. Bhal nalagile price-r kotha-ei nohoi. Bhal lagile option dim."`,
        `"Busy asu" → "Nischoi. Demo-tu WhatsApp-t pothiai diu? Free hole sai lob."`,
        `"Bhabi kom" → "Demo nosai bhabibo tan. Pothiai diu, kaali phone koru ne porohi?"`,
        `"Lora/bhatija-e bonai dibo" → "Bhal kotha! Demo pothiai diu, teuluko idea pabo. Bhal lagile ready-made di dim."`,
      ],
    },
  ];
}
