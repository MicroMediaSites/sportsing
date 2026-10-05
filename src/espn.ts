// ESPN's free, no-key JSON API. Originally the stats source for the live 2026
// World Cup (`soccer/fifa.world`, used by stats / predict / the overlay); now
// league-parametrized so NBA and NHL reuse the same client. Returns
// scoreboards, team schedules, team lists, standings, per-team match
// statistics, and key events.
//
// Undocumented/unofficial: the shapes here are observed, not contracted, and
// could change. All ESPN-specific parsing is contained in this module so a
// break is a one-file fix. Reuses api.ts's disk cache; every cache key carries
// the league so leagues never collide.

import { cached, ApiError } from "./api.ts";
import { c } from "./ansi.ts";
import type { Broadcast, BroadcastMarket, Game, GameCompetitor, SeasonPhase } from "./game.ts";

/** ESPN league paths this client speaks. A closed set — the path is
 *  interpolated into request URLs and cache filenames, so no free text. */
export const LEAGUES = {
  fifa: "soccer/fifa.world",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
} as const;
export type League = (typeof LEAGUES)[keyof typeof LEAGUES];

/** The default league — every pre-existing (World Cup) call site uses it. */
export const FIFA: League = LEAGUES.fifa;

/** ESPN season types for team schedules (`seasontype=`). */
export const SEASON_TYPES = { preseason: 1, regular: 2, postseason: 3 } as const;
export type SeasonType = (typeof SEASON_TYPES)[keyof typeof SEASON_TYPES];

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
// Standings live on a different path: `site/v2/.../standings` only returns a
// `fullViewLink` stub; the real tables are under `apis/v2`.
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";

/** Full URL for a `site/v2` endpoint under `league`, e.g. `scoreboard?dates=…`. */
export function espnUrl(league: League, path: string): string {
  return `${SITE}/${league}/${path}`;
}

/** Disk-cache key for an ESPN response: always includes the league, and is
 *  filename-safe (ids come from user terms / API data, never trusted as paths). */
export function espnCacheKey(league: League, kind: string, id: string | number = ""): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
  return ["espn", safe(league), kind, safe(String(id))].filter(Boolean).join("_");
}

// ESPN's edge (Akamai) 403s Bun's default `Bun/x.y.z` User-Agent (observed
// 2026-10-04 — every ESPN call failed). Any other UA is served, so name ourselves.
const HEADERS = { "User-Agent": "sportsing" };

/** GET + JSON through the disk cache; non-2xx becomes an ApiError. */
function fetchEspn<T = any>(url: string, key: string, ttlMs: number, what: string): Promise<T> {
  return cached<T>(key, ttlMs, async () => {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new ApiError(res.status, `ESPN ${what} request failed (HTTP ${res.status}).`);
    return res.json() as Promise<T>;
  });
}

/**
 * Detect a *structurally* wrong scoreboard (or team-schedule — same `events`
 * shape) response, for any league. ESPN is unofficial and
 * returns HTTP 200 even when its JSON shape drifts, so the parser's `?? ""`
 * fallbacks would silently degrade to blank stats — indistinguishable from
 * "no data yet". This keys on shape, NOT emptiness: a date with no matches
 * (`events: []`) and a pre-kickoff match with no stats are both fine.
 *
 * Off when: the `events` key is missing or not an array, or an *in-play* event
 * has zero competitors or unnamed ("?") teams (a live match always has named
 * competitors — if it doesn't, the nested shape changed).
 */
export function looksOff(raw: any): boolean {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.events)) return true;
  for (const e of raw.events) {
    const comp = e?.competitions?.[0];
    // Status lives on the competition, but ESPN sometimes mirrors it on the event
    // itself — check both, same fallback normalizeEvent uses.
    const state = comp?.status?.type?.state ?? e?.status?.type?.state;
    if (state !== "in") continue; // only live matches must have full structure
    const competitors = comp?.competitors ?? [];
    if (competitors.length === 0) return true;
    if (!competitors.every((cc: any) => cc?.team?.displayName ?? cc?.team?.name)) return true;
  }
  return false;
}

let driftWarned = false;

/** Emit the ESPN-drift warning to stderr, at most once per process run. */
function warnDriftOnce(): void {
  if (driftWarned) return;
  driftWarned = true;
  console.error(c.yellow("⚠ ESPN data looks off — its format may have changed; it's an unofficial API."));
}

/** Teams-list drift: `sports[0].leagues[0].teams` must be an array whose
 *  entries carry a `team` with an id and abbreviation. */
export function looksOffTeams(raw: any): boolean {
  const teams = raw?.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(teams)) return true;
  return teams.some((t: any) => !t?.team?.id || !t?.team?.abbreviation);
}

/** Standings drift: either a `children` array of groups (conferences / WC
 *  groups — or conferences nesting divisions, with `level=3`) or a top-level
 *  `standings`; every leaf group has an `entries` array whose rows name a team.
 *  An empty table (offseason) is fine — shape, not emptiness. */
export function looksOffStandings(raw: any): boolean {
  if (!raw || typeof raw !== "object") return true;
  const groups = Array.isArray(raw.children) ? raw.children : raw.standings ? [raw] : null;
  if (!groups) return true;
  return groups.some(groupLooksOff);
}

function groupLooksOff(g: any): boolean {
  if (Array.isArray(g?.children) && !g?.standings) return g.children.length === 0 || g.children.some(groupLooksOff);
  const entries = g?.standings?.entries;
  if (!Array.isArray(entries)) return true;
  return !entries.every((e: any) => e?.team?.abbreviation && Array.isArray(e?.stats));
}

/** WC2026 scoreboard search window (YYYYMMDD) — opening day → final. */
export const TOURNAMENT_START = "20260611";
export const TOURNAMENT_END = "20260719";

export interface EspnCompetitor {
  homeAway: "home" | "away";
  name: string;
  abbreviation: string;
  score: string;
}

export interface EspnEvent {
  id: string;
  date: string;
  name: string;
  /** "pre" (scheduled), "in" (live), "post" (finished). */
  state: "pre" | "in" | "post";
  detail: string; // e.g. "FT", "45'", "1:00 - 1st Half"
  competitors: EspnCompetitor[];
}

/** One team's stat block for a match: a flat list of named stat rows. */
export interface EspnTeamStats {
  team: string;
  abbreviation: string;
  stats: { name: string; label: string; value: string }[];
}

/** ESPN scores arrive as a string on scoreboards but as `{ value, displayValue }`
 *  on team schedules (and `null` before tip-off) — flatten to a string. */
function scoreOf(raw: any): string {
  if (raw == null) return "";
  if (typeof raw === "object") return String(raw.displayValue ?? raw.value ?? "");
  return String(raw);
}

/** One scoreboard / schedule event → EspnEvent. Exported for tests. */
export function normalizeEvent(e: any): EspnEvent {
  const comp = e.competitions?.[0] ?? {};
  return {
    id: String(e.id),
    date: e.date,
    name: e.name ?? e.shortName ?? "",
    state: comp.status?.type?.state ?? e.status?.type?.state ?? "pre",
    detail: comp.status?.type?.shortDetail ?? e.status?.type?.shortDetail ?? "",
    competitors: (comp.competitors ?? []).map((c: any) => ({
      homeAway: c.homeAway,
      name: c.team?.displayName ?? c.team?.name ?? "?",
      abbreviation: c.team?.abbreviation ?? "",
      score: scoreOf(c.score),
    })),
  };
}

// --- ESPN event → sport-neutral Game (NBA/NHL) ---

/** ESPN season-type number → phase. 5 is the NBA play-in, which leads into
 *  (and is shown with) the playoffs. 4 (off-season) and anything unknown → null. */
function seasonPhaseOf(n: unknown): SeasonPhase | null {
  switch (Number(n)) {
    case 1:
      return "preseason";
    case 2:
      return "regular";
    case 3:
    case 5:
      return "postseason";
    default:
      return null;
  }
}

const MARKETS: Record<string, BroadcastMarket> = { national: "national", home: "home", away: "away" };

/**
 * A competition's broadcasts. ESPN uses two shapes: team schedules (and the
 * scoreboard's `geoBroadcasts`) list `{ market: { type: "Away" }, media:
 * { shortName: "Utah 16" } }`; the scoreboard's `broadcasts` is the condensed
 * `{ market: "national", names: ["NBA TV"] }`. Prefer the detailed form. Rows
 * with an unknown market are dropped rather than guessed — mislabeling a
 * regional feed as national would wrongly claim it's watchable anywhere.
 */
function broadcastsOf(comp: any): Broadcast[] {
  const detailed: any[] = Array.isArray(comp?.geoBroadcasts) && comp.geoBroadcasts.length
    ? comp.geoBroadcasts
    : (comp?.broadcasts ?? []).filter((b: any) => b && typeof b.market === "object");
  const rows: { market: unknown; name: unknown }[] = detailed.length
    ? detailed.map((b: any) => ({ market: b?.market?.type, name: b?.media?.shortName ?? b?.media?.name }))
    : (comp?.broadcasts ?? []).flatMap((b: any) =>
        (Array.isArray(b?.names) ? b.names : []).map((name: unknown) => ({ market: b?.market, name })),
      );
  const out: Broadcast[] = [];
  for (const r of rows) {
    const market = MARKETS[String(r.market ?? "").toLowerCase()];
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!market || !name) continue;
    if (out.some((b) => b.name === name && b.market === market)) continue;
    out.push({ name, market });
  }
  return out;
}

function competitorOf(comp: any, side: "home" | "away"): GameCompetitor {
  const entry = (comp?.competitors ?? []).find((x: any) => x?.homeAway === side);
  return {
    id: String(entry?.team?.id ?? entry?.id ?? ""),
    name: entry?.team?.displayName ?? entry?.team?.name ?? "TBD",
    abbreviation: entry?.team?.abbreviation ?? "",
    score: scoreOf(entry?.score),
  };
}

/**
 * One ESPN scoreboard or team-schedule event → `Game`. Season type comes from
 * the event (`seasonType.type` on schedules, `season.type` on scoreboards),
 * falling back to `requested` (the `seasontype=` the schedule was fetched
 * with), then "regular". Exported for tests.
 */
export function toGame(e: any, requested?: SeasonType): Game {
  const comp = e?.competitions?.[0] ?? {};
  const status = comp.status ?? e?.status ?? {};
  const state: Game["state"] = status.type?.state === "in" || status.type?.state === "post" ? status.type.state : "pre";
  return {
    id: String(e?.id ?? ""),
    date: e?.date ?? comp.date ?? "",
    name: e?.name ?? e?.shortName ?? "",
    state,
    detail: status.type?.shortDetail ?? status.type?.detail ?? "",
    period: Number(status.period) || 0,
    clock: state === "in" ? String(status.displayClock ?? "") : "",
    seasonType:
      seasonPhaseOf(e?.seasonType?.type) ?? seasonPhaseOf(e?.season?.type) ?? seasonPhaseOf(requested) ?? "regular",
    home: competitorOf(comp, "home"),
    away: competitorOf(comp, "away"),
    broadcasts: broadcastsOf(comp),
  };
}

/** Scoreboard events for a date or `YYYYMMDD-YYYYMMDD` range in `league`. */
export async function getScoreboard(dates: string, ttlMs = 60_000, league: League = FIFA): Promise<EspnEvent[]> {
  const raw = await fetchEspn(
    espnUrl(league, `scoreboard?dates=${encodeURIComponent(dates)}`),
    espnCacheKey(league, "sb", dates),
    ttlMs,
    "scoreboard",
  );
  if (looksOff(raw)) warnDriftOnce();
  return (raw?.events ?? []).map(normalizeEvent);
}

/** One team's schedule for a season type (1 = preseason, 2 = regular,
 *  3 = postseason) in `league`. `team` is an ESPN team id or abbreviation
 *  (e.g. Jazz `26`, Mammoth `129764`). ESPN returns `events: []` for a season
 *  type with nothing scheduled yet (e.g. postseason in October). */
export async function getTeamSchedule(
  league: League,
  team: string | number,
  seasonType: SeasonType,
  ttlMs = 5 * 60_000,
): Promise<EspnEvent[]> {
  return (await rawTeamSchedule(league, team, seasonType, ttlMs)).map(normalizeEvent);
}

/** Raw schedule events (drift-checked) — shared by getTeamSchedule/getTeamGames. */
async function rawTeamSchedule(league: League, team: string | number, seasonType: SeasonType, ttlMs: number): Promise<any[]> {
  const raw = await fetchEspn(
    espnUrl(league, `teams/${encodeURIComponent(String(team))}/schedule?seasontype=${seasonType}`),
    espnCacheKey(league, `sched${seasonType}`, team),
    ttlMs,
    "team schedule",
  );
  if (looksOff(raw)) warnDriftOnce();
  return raw?.events ?? [];
}

/** One team's schedule for a season type as sport-neutral `Game`s. */
export async function getTeamGames(
  league: League,
  team: string | number,
  seasonType: SeasonType,
  ttlMs = 5 * 60_000,
): Promise<Game[]> {
  return (await rawTeamSchedule(league, team, seasonType, ttlMs)).map((e) => toGame(e, seasonType));
}

/** A single day's scoreboard (`YYYYMMDD`) in `league` as `Game`s. Same cache
 *  entry as getScoreboard. Single dates only — ESPN's `dates=A-B` ranges are
 *  unreliable for NBA/NHL. */
export async function getScoreboardGames(league: League, date: string, ttlMs = 60_000): Promise<Game[]> {
  if (!/^\d{8}$/.test(date)) throw new Error(`getScoreboardGames expects one YYYYMMDD date, got "${date}".`);
  const raw = await fetchEspn(
    espnUrl(league, `scoreboard?dates=${encodeURIComponent(date)}`),
    espnCacheKey(league, "sb", date),
    ttlMs,
    "scoreboard",
  );
  if (looksOff(raw)) warnDriftOnce();
  return (raw?.events ?? []).map((e: any) => toGame(e));
}

export interface EspnTeam {
  id: string;
  abbreviation: string;
  /** Full name, e.g. "Utah Jazz". */
  name: string;
  /** Nickname, e.g. "Jazz". */
  shortName: string;
  location: string;
}

/** Parse a `/teams` response. Exported for tests. */
export function parseTeams(raw: any): EspnTeam[] {
  const teams = raw?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return (Array.isArray(teams) ? teams : []).map((t: any) => ({
    id: String(t?.team?.id ?? ""),
    abbreviation: t?.team?.abbreviation ?? "",
    name: t?.team?.displayName ?? t?.team?.name ?? "?",
    shortName: t?.team?.shortDisplayName ?? t?.team?.name ?? "",
    location: t?.team?.location ?? "",
  }));
}

/** Every team in `league`. Long TTL — rosters of franchises barely change. */
export async function getTeams(league: League, ttlMs = 24 * 60 * 60_000): Promise<EspnTeam[]> {
  const raw = await fetchEspn(espnUrl(league, "teams"), espnCacheKey(league, "teams"), ttlMs, "teams");
  if (looksOffTeams(raw)) warnDriftOnce();
  return parseTeams(raw);
}

export interface EspnStandingsEntry {
  teamId: string;
  team: string;
  abbreviation: string;
  /** Stat name → display value (e.g. wins, losses, points, playoffSeed). */
  stats: Record<string, string>;
}

export interface EspnStandingsGroup {
  /** e.g. "Western Conference", "Pacific Division", "Group A". */
  name: string;
  abbreviation: string;
  /** The enclosing group for a nested table (a division's conference), else null. */
  parent: { name: string; abbreviation: string } | null;
  entries: EspnStandingsEntry[];
}

export interface EspnStandings {
  /** ESPN season year — the year the season ends (2026-27 → 2027); null if absent. */
  season: number | null;
  /** e.g. "2026-27"; "" if absent. */
  seasonName: string;
  groups: EspnStandingsGroup[];
}

/** Parse a standings response's tables (conference/group children, divisions
 *  nested under conferences, or a single top-level table), flattened to the
 *  leaf tables in ESPN's order. Exported for tests. */
export function parseStandings(raw: any): EspnStandingsGroup[] {
  const groups: any[] = Array.isArray(raw?.children) ? raw.children : raw?.standings ? [raw] : [];
  return groups.flatMap((g) => leafGroups(g, null));
}

function leafGroups(g: any, parent: EspnStandingsGroup["parent"]): EspnStandingsGroup[] {
  const name = g?.name ?? "";
  const abbreviation = g?.abbreviation ?? "";
  if (Array.isArray(g?.children) && !g?.standings) {
    return g.children.flatMap((child: any) => leafGroups(child, { name, abbreviation }));
  }
  return [
    {
      name,
      abbreviation,
      parent,
      entries: (g?.standings?.entries ?? []).map((e: any) => ({
        teamId: String(e?.team?.id ?? ""),
        team: e?.team?.displayName ?? e?.team?.name ?? "?",
        abbreviation: e?.team?.abbreviation ?? "",
        stats: Object.fromEntries(
          (e?.stats ?? [])
            .filter((s: any) => s?.name)
            .map((s: any) => [s.name, String(s.displayValue ?? s.value ?? "")]),
        ),
      })),
    },
  ];
}

/** Parse a whole standings response: season metadata plus its tables. Exported for tests. */
export function parseStandingsResponse(raw: any): EspnStandings {
  const year = Number(raw?.season?.year);
  return {
    season: Number.isInteger(year) && year > 0 ? year : null,
    seasonName: String(raw?.season?.displayName ?? ""),
    groups: parseStandings(raw),
  };
}

/** Which standings to fetch. Omitted fields take ESPN's defaults (current
 *  season, its current season type, conference tables). */
export interface StandingsQuery {
  /** ESPN season year (the year the season ends). */
  season?: number;
  seasonType?: SeasonType;
  /** "division" nests division tables under conferences (`level=3`). */
  level?: "conference" | "division";
}

/** Standings for `league`, grouped (NBA/NHL conferences or divisions, WC groups). */
export async function getStandings(league: League, query: StandingsQuery = {}, ttlMs = 10 * 60_000): Promise<EspnStandings> {
  const params = new URLSearchParams();
  if (query.season !== undefined) params.set("season", String(query.season));
  if (query.seasonType !== undefined) params.set("seasontype", String(query.seasonType));
  if (query.level === "division") params.set("level", "3");
  const qs = params.toString();
  const raw = await fetchEspn(
    `${STANDINGS_BASE}/${league}/standings${qs ? `?${qs}` : ""}`,
    espnCacheKey(league, "standings", qs),
    ttlMs,
    "standings",
  );
  if (looksOffStandings(raw)) warnDriftOnce();
  return parseStandingsResponse(raw);
}

/** Every tournament event — played and upcoming (opening day → final). The full
 *  window so `predict` can see matches days out, not just the next day. */
export async function getEvents(ttlMs = 60_000): Promise<EspnEvent[]> {
  return getScoreboard(`${TOURNAMENT_START}-${TOURNAMENT_END}`, ttlMs);
}

function eventHasTeam(e: EspnEvent, term: string): boolean {
  return e.competitors.some(
    (c) => c.name.toLowerCase().includes(term) || c.abbreviation.toLowerCase() === term,
  );
}

/**
 * Resolve free-text terms to a single event. Every term must match a team
 * (so "USA" → any USA game; "USA Paraguay" → that specific game). With
 * `playedOnly`, ignores not-yet-started games. Returns the most recent match.
 */
export async function findEvent(terms: string[], opts: { playedOnly?: boolean } = {}): Promise<EspnEvent | null> {
  const t = terms.map((s) => s.toLowerCase());
  let events = (await getEvents()).filter((e) => t.every((term) => eventHasTeam(e, term)));
  if (opts.playedOnly) events = events.filter((e) => e.state !== "pre");
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return events[0] ?? null;
}

export interface H2HGame {
  date: string;
  score: string;
  result: "W" | "D" | "L" | "?";
}

/** Prior meetings between the two sides of an event (summary headToHeadGames),
 *  results from the first listed team's perspective. */
export async function getHeadToHead(
  eventId: string,
  ttlMs = 60 * 60_000,
  league: League = FIFA,
): Promise<{ team: string; games: H2HGame[] }> {
  // Separate cache key from getMatchStats (which also hits /summary on a short
  // TTL) — a shared key would let the shorter TTL win and refetch H2H needlessly.
  const raw = await fetchEspn(
    espnUrl(league, `summary?event=${encodeURIComponent(eventId)}`),
    espnCacheKey(league, "h2h", eventId),
    ttlMs,
    "summary",
  );
  const block = (raw.headToHeadGames ?? [])[0];
  if (!block) return { team: "", games: [] };
  const games: H2HGame[] = (block.events ?? []).map((e: any) => {
    const [a, b] = String(e.score ?? "").split("-").map(Number);
    const result: H2HGame["result"] =
      a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b) ? "?" : a > b ? "W" : a < b ? "L" : "D";
    return { date: String(e.gameDate ?? e.date ?? "").slice(0, 10), score: String(e.score ?? ""), result };
  });
  return { team: block.team?.displayName ?? "", games };
}

export interface LiveMatch {
  detail: string; // clock/status, e.g. "66'", "HT", "FT"
  state: "pre" | "in" | "post";
  kickoff: string; // ISO kickoff time (for the pre-game countdown)
  homeAbbr: string;
  awayAbbr: string;
  homeScore: string;
  awayScore: string;
  possession?: [string, string];
  shots?: [string, string];
  onTarget?: [string, string];
  /** Market-implied win % (de-vigged) from ESPN odds: [home, draw, away], 0–100. */
  winProb?: [number, number, number];
  /** Raw 3-way odds line, e.g. "QAT +1500 / X +600 / SUI -525". */
  oddsLine?: string;
  /** Notable in-match events (goals, cards, subs…), most recent first. */
  events?: { clock: string; type: string; team: string; text: string }[];
}

/** American moneyline → implied probability (0–1). */
function mlToProb(ml: number): number {
  return ml >= 0 ? 100 / (ml + 100) : -ml / (-ml + 100);
}

/** Fresh live state for one match in a single call: clock + score (summary
 *  header) and stats (boxscore). Short TTL — this drives the live overlay. */
export async function getLiveMatch(eventId: string, ttlMs = 5_000, league: League = FIFA): Promise<LiveMatch | null> {
  const raw = await fetchEspn(
    espnUrl(league, `summary?event=${encodeURIComponent(eventId)}`),
    espnCacheKey(league, "live", eventId),
    ttlMs,
    "summary",
  );
  const comp = raw.header?.competitions?.[0];
  if (!comp) return null;
  const hc = (comp.competitors ?? []).find((c: any) => c.homeAway === "home");
  const ac = (comp.competitors ?? []).find((c: any) => c.homeAway === "away");
  const teams = raw.boxscore?.teams ?? [];
  const byAbbr = (a?: string) => teams.find((t: any) => t.team?.abbreviation === a);
  const ht = byAbbr(hc?.team?.abbreviation) ?? teams[0];
  const at = byAbbr(ac?.team?.abbreviation) ?? teams[1];
  const stat = (t: any, n: string): string | undefined => {
    const s = (t?.statistics ?? []).find((x: any) => x.name === n);
    return s ? String(s.displayValue) : undefined;
  };
  const pair = (n: string): [string, string] | undefined => {
    const h = stat(ht, n);
    const a = stat(at, n);
    return h === undefined && a === undefined ? undefined : [h ?? "—", a ?? "—"];
  };
  const homeAbbr = hc?.team?.abbreviation ?? "?";
  const awayAbbr = ac?.team?.abbreviation ?? "?";

  // Notable in-match events (goals, cards, subs, VAR…) from the summary's
  // keyEvents feed — most recent first, capped so the overlay panel stays small.
  const events = (raw.keyEvents ?? [])
    .map((k: any) => ({
      clock: k.clock?.displayValue ?? "",
      type: k.type?.text ?? "",
      team: k.team?.abbreviation ?? k.team?.displayName ?? "",
      text: k.text ?? k.shortText ?? "",
    }))
    .filter((e: { type: string; text: string }) => e.type || e.text)
    .reverse()
    .slice(0, 8);

  // Win probability + odds line, derived from the 3-way moneyline.
  let winProb: [number, number, number] | undefined;
  let oddsLine: string | undefined;
  const o = raw.pickcenter?.[0] ?? raw.odds?.[0];
  const hml = o?.homeTeamOdds?.moneyLine;
  const aml = o?.awayTeamOdds?.moneyLine;
  const dml = o?.drawOdds?.moneyLine;
  if (typeof hml === "number" && typeof aml === "number" && typeof dml === "number") {
    const ph = mlToProb(hml);
    const pd = mlToProb(dml);
    const pa = mlToProb(aml);
    const sum = ph + pd + pa;
    winProb = sum > 0 ? [Math.round((ph / sum) * 100), Math.round((pd / sum) * 100), Math.round((pa / sum) * 100)] : undefined;
    const fmt = (n: number) => (n >= 0 ? "+" + n : String(n));
    oddsLine = `${homeAbbr} ${fmt(hml)} / X ${fmt(dml)} / ${awayAbbr} ${fmt(aml)}`;
  }

  return {
    detail: comp.status?.type?.shortDetail ?? "",
    state: comp.status?.type?.state ?? "pre",
    kickoff: comp.date ?? "",
    homeAbbr,
    awayAbbr,
    homeScore: String(hc?.score ?? "0"),
    awayScore: String(ac?.score ?? "0"),
    possession: pair("possessionPct"),
    shots: pair("totalShots"),
    onTarget: pair("shotsOnTarget"),
    winProb,
    oddsLine,
    events,
  };
}

/** Resolve terms to the *currently relevant* match: live now → today → next
 *  upcoming → most recent. (findEvent returns the latest-scheduled, which is
 *  wrong for "watch <team>" when a team has several fixtures.) */
export async function findCurrentMatch(terms: string[]): Promise<EspnEvent | null> {
  const t = terms.map((s) => s.toLowerCase());
  const events = (await getEvents()).filter((e) => t.every((term) => eventHasTeam(e, term)));
  if (!events.length) return null;
  const live = events.find((e) => e.state === "in");
  if (live) return live;
  const today = new Date().toLocaleDateString();
  const todayGame = events.find((e) => new Date(e.date).toLocaleDateString() === today);
  if (todayGame) return todayGame;
  const upcoming = events.filter((e) => e.state === "pre").sort((a, b) => +new Date(a.date) - +new Date(b.date))[0];
  if (upcoming) return upcoming;
  return events.sort((a, b) => +new Date(b.date) - +new Date(a.date))[0] ?? null;
}

/** The match `watch --wait` should poll toward: a currently-live one matching
 *  `terms` (or any live match if `terms` is empty), else the soonest upcoming.
 *  Returns null when nothing matching is live or scheduled. Short default TTL so
 *  the kickoff→in-play transition is seen promptly. ESPN's `state` is the live
 *  signal (no key, same source the overlay follows — unlike the lagging
 *  football-data feed behind `live`). */
export async function resolveWatchTarget(terms: string[], ttlMs = 15_000): Promise<EspnEvent | null> {
  const t = terms.map((s) => s.toLowerCase());
  const events = (await getEvents(ttlMs)).filter((e) => t.every((term) => eventHasTeam(e, term)));
  const live = events.find((e) => e.state === "in");
  if (live) return live;
  return events.filter((e) => e.state === "pre").sort((a, b) => +new Date(a.date) - +new Date(b.date))[0] ?? null;
}

/** Per-team statistics for one event (from the summary boxscore). */
export async function getMatchStats(eventId: string, ttlMs = 60_000, league: League = FIFA): Promise<EspnTeamStats[]> {
  const raw = await fetchEspn(
    espnUrl(league, `summary?event=${encodeURIComponent(eventId)}`),
    espnCacheKey(league, "sum", eventId),
    ttlMs,
    "summary",
  );
  const teams = raw.boxscore?.teams ?? [];
  return teams.map((t: any) => ({
    team: t.team?.displayName ?? t.team?.name ?? "?",
    abbreviation: t.team?.abbreviation ?? "",
    stats: (t.statistics ?? []).map((s: any) => ({
      name: s.name,
      label: s.label ?? s.name,
      value: String(s.displayValue ?? s.value ?? ""),
    })),
  }));
}
