// Detect which match the user is on from the stream page's document.title, so
// the overlay can follow them. Peacock/Telemundo titles are Spanish
// ("Catar v. Suiza - Peacock"); Fubo/Fox are English. We canonicalize each
// side to an ESPN team abbreviation (TLA) when we know the Spanish alias, else
// pass the raw token through (English names resolve by name match downstream).

/** Normalized Spanish (and a few English) team names → ESPN TLA. */
const NAME_TO_TLA: Record<string, string> = {
  "estados unidos": "USA",
  catar: "QAT",
  suiza: "SUI",
  brasil: "BRA",
  marruecos: "MAR",
  turquia: "TUR",
  "corea del sur": "KOR",
  sudafrica: "RSA",
  mexico: "MEX",
  chequia: "CZE",
  "republica checa": "CZE",
  "bosnia y herzegovina": "BIH",
  canada: "CAN",
  haiti: "HAI",
  escocia: "SCO",
  argelia: "ALG",
  belgica: "BEL",
  alemania: "GER",
  espana: "ESP",
  inglaterra: "ENG",
  francia: "FRA",
  croacia: "CRO",
  "paises bajos": "NED",
  holanda: "NED",
  japon: "JPN",
  // identical or near-identical across languages (still useful as explicit hits)
  paraguay: "PAR",
  australia: "AUS",
  argentina: "ARG",
  portugal: "POR",
  uruguay: "URU",
  colombia: "COL",
  senegal: "SEN",
  ecuador: "ECU",
};

/** Lowercase + strip accents/punctuation for forgiving lookup. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

function canonical(token: string): string {
  const n = normalize(token);
  return NAME_TO_TLA[n] ?? n; // TLA when known, else the normalized token
}

export type StreamLang = "english" | "spanish";

export type PageContext =
  | { kind: "match"; teams: [string, string]; lang?: StreamLang }
  | { kind: "today" }
  | { kind: "unknown" };

// Team names that are *distinctively* one language (the normalized form differs
// across English/Spanish), so seeing one in a title reveals the broadcast cast.
// These are EXPLICIT (not derived from NAME_TO_TLA) on purpose: NAME_TO_TLA is a
// lookup table whose keys could gain English-form entries, which would silently
// corrupt language inference. Language-neutral names (Mexico, Paraguay, Australia,
// Argentina, Portugal, Uruguay, Colombia, Senegal, Ecuador, Canada, Haiti) carry
// no signal and appear in neither set.
const SPANISH_NAMES = new Set([
  "estados unidos", "catar", "suiza", "brasil", "marruecos", "turquia", "corea del sur",
  "sudafrica", "chequia", "republica checa", "bosnia y herzegovina", "escocia", "argelia",
  "belgica", "alemania", "espana", "inglaterra", "francia", "croacia", "paises bajos",
  "holanda", "japon",
]);
const ENGLISH_NAMES = new Set([
  "united states", "qatar", "switzerland", "brazil", "morocco", "turkey", "turkiye",
  "south korea", "south africa", "czechia", "czech republic", "bosnia and herzegovina",
  "scotland", "algeria", "belgium", "germany", "spain", "england", "france", "croatia",
  "netherlands", "holland", "japan",
]);

/** Infer the broadcast language from the two team tokens + provider suffix.
 *  Conservative: returns undefined when undeterminable (so callers never warn on
 *  a guess). A distinctive team name decides it — Spanish is checked first, so a
 *  mixed title (one Spanish, one English token — not expected in a real cast)
 *  resolves to spanish. Otherwise Peacock's World Cup feed is Telemundo (Spanish). */
function inferLang(a: string, b: string, isPeacock: boolean): StreamLang | undefined {
  const na = normalize(a);
  const nb = normalize(b);
  if (SPANISH_NAMES.has(na) || SPANISH_NAMES.has(nb)) return "spanish";
  if (ENGLISH_NAMES.has(na) || ENGLISH_NAMES.has(nb)) return "english";
  if (isPeacock) return "spanish";
  return undefined; // e.g. Fubo + only language-neutral names — can't tell
}

/**
 * Classify a stream page from its title.
 *  - "<A> v. <B> - Provider"  → match (teams canonicalized to TLA/name; lang when known)
 *  - World Cup hub / home     → today
 *  - anything else            → unknown (overlay keeps its current match)
 */
export function detectFromTitle(title: string): PageContext {
  const raw = title || "";
  const isPeacock = /peacock/i.test(raw);
  const t = raw.replace(/\s*[-|]\s*(Peacock|Fubo|fubo\.tv).*$/i, "").trim();

  const vs = t.match(/^(.+?)\s+(?:v\.?|vs\.?|versus)\s+(.+)$/i);
  if (vs && vs[1] && vs[2]) {
    const lang = inferLang(vs[1], vs[2], isPeacock);
    const teams: [string, string] = [canonical(vs[1]), canonical(vs[2])];
    return lang ? { kind: "match", teams, lang } : { kind: "match", teams };
  }

  const n = normalize(t);
  if (/(copa mundial|world cup|fifa|home|inicio)/.test(n)) return { kind: "today" };

  return { kind: "unknown" };
}

/** Candidate substrings to recognize a team on a provider page (English name,
 *  abbreviation, and any Spanish aliases) — for finding a game tile to click. */
export function searchTerms(name: string, abbr: string): string[] {
  const out = new Set<string>();
  if (name) out.add(normalize(name));
  if (abbr) out.add(abbr.toLowerCase());
  const tla = abbr.toUpperCase();
  for (const [alias, t] of Object.entries(NAME_TO_TLA)) {
    if (t === tla) out.add(alias);
  }
  return [...out].filter(Boolean);
}
