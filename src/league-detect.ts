// Which NBA/NHL game a stream page is showing, from its document.title — so the
// overlay follows the game you click into on Fubo. English team names, matched
// against the league's ESPN /teams list: full name ("Utah Jazz"), nickname
// ("Jazz"), a location only one team in the league has ("Utah"), or an
// abbreviation / league alias as an uppercase token ("UTA"). The separator
// ("at", "vs", "@", "v.") doesn't matter: a title naming exactly two teams is
// that matchup. Pure — the caller resolves the pair to a game.

import type { EspnTeam } from "./espn.ts";
import type { Game } from "./game.ts";

/** Lowercase, strip accents and punctuation, collapse spaces ("Montréal" → "montreal"). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Hit {
  teamId: string;
  start: number;
  end: number;
  full: boolean;
}

/** Every [start, end) where `needle` appears in `hay` as whole words. */
function wordSpans(hay: string, needle: string): [number, number][] {
  const out: [number, number][] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const end = i + needle.length;
    if ((i === 0 || hay[i - 1] === " ") && (end === hay.length || hay[end] === " ")) out.push([i, end]);
  }
  return out;
}

/** Team mentions in a title, nested ones dropped ("Utah" inside "Utah Jazz"). */
function mentions(title: string, teams: EspnTeam[], aliases: Record<string, string>): Hit[] {
  const text = normalize(title);
  // Uppercase tokens of the raw title, for abbreviation matches ("UTA @ DEN").
  const tokens = new Set(title.split(/[^A-Za-z0-9]+/).filter((t) => t.length >= 2 && t === t.toUpperCase()));
  const locationCount = new Map<string, number>();
  for (const t of teams) {
    const loc = normalize(t.location);
    if (loc) locationCount.set(loc, (locationCount.get(loc) ?? 0) + 1);
  }

  const hits: Hit[] = [];
  for (const t of teams) {
    const names = [
      { n: normalize(t.name), full: true },
      { n: normalize(t.shortName), full: false },
    ];
    const loc = normalize(t.location);
    if (loc && locationCount.get(loc) === 1) names.push({ n: loc, full: false });
    for (const { n, full } of names) {
      for (const [start, end] of wordSpans(text, n)) hits.push({ teamId: t.id, start, end, full });
    }
    const codes = [t.abbreviation, ...Object.keys(aliases).filter((k) => aliases[k]!.toUpperCase() === t.abbreviation.toUpperCase())];
    // Abbreviation hits have no position in the normalized text; give each a
    // unique span past the end so they never nest with (or inside) a name hit.
    codes.forEach((code, i) => {
      if (code && tokens.has(code.toUpperCase())) hits.push({ teamId: t.id, start: text.length + 1 + i, end: text.length + 1 + i, full: false });
    });
  }
  // Keep a hit only if no longer hit strictly contains it.
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start),
  );
}

/**
 * The two team ids a page title names, or null when it doesn't name exactly
 * two teams of this league. If loose matches (nicknames, locations, codes)
 * find more than two teams, full names alone decide.
 */
export function teamsFromTitle(
  title: string,
  teams: EspnTeam[],
  aliases: Record<string, string> = {},
): [string, string] | null {
  const hits = mentions(title, teams, aliases);
  const distinct = (hs: Hit[]) => [...new Set(hs.map((h) => h.teamId))];
  let ids = distinct(hits);
  if (ids.length > 2) ids = distinct(hits.filter((h) => h.full));
  return ids.length === 2 ? [ids[0]!, ids[1]!] : null;
}

/**
 * The game between two teams in `games` (matched by ESPN team id): the live
 * one if any, else the one starting closest to `now`. Null if they don't meet.
 */
export function gameBetween(games: Game[], ids: [string, string], now: number): Game | null {
  const [a, b] = ids;
  const meet = games.filter((g) => (g.home.id === a && g.away.id === b) || (g.home.id === b && g.away.id === a));
  return (
    meet.find((g) => g.state === "in") ??
    meet.sort((x, y) => Math.abs(Date.parse(x.date) - now) - Math.abs(Date.parse(y.date) - now))[0] ??
    null
  );
}
