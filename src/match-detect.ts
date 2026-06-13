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

export type PageContext =
  | { kind: "match"; teams: [string, string] }
  | { kind: "today" }
  | { kind: "unknown" };

/**
 * Classify a stream page from its title.
 *  - "<A> v. <B> - Provider"  → match (teams canonicalized to TLA/name)
 *  - World Cup hub / home     → today
 *  - anything else            → unknown (overlay keeps its current match)
 */
export function detectFromTitle(title: string): PageContext {
  const t = (title || "").replace(/\s*[-|]\s*(Peacock|Fubo|fubo\.tv).*$/i, "").trim();

  const vs = t.match(/^(.+?)\s+(?:v\.?|vs\.?|versus)\s+(.+)$/i);
  if (vs && vs[1] && vs[2]) {
    return { kind: "match", teams: [canonical(vs[1]), canonical(vs[2])] };
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
