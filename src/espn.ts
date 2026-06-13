// ESPN's free, no-key JSON API — the stats source for the live 2026 World Cup.
// Used by stats / predict. Returns per-team match statistics (possession,
// shots, passes, cards…), rosters, and key events for `soccer/fifa.world`.
//
// Undocumented/unofficial: the shapes here are observed, not contracted, and
// could change. All ESPN-specific parsing is contained in this module so a
// break is a one-file fix. Reuses api.ts's disk cache.

import { cached, ApiError } from "./api.ts";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";

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

function normalizeEvent(e: any): EspnEvent {
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
      score: c.score ?? "",
    })),
  };
}

/** Scoreboard events for a date or `YYYYMMDD-YYYYMMDD` range. */
export async function getScoreboard(dates: string, ttlMs = 60_000): Promise<EspnEvent[]> {
  const raw = await cached<any>(`espn_sb_${dates}`, ttlMs, async () => {
    const res = await fetch(`${BASE}/scoreboard?dates=${dates}`);
    if (!res.ok) throw new ApiError(res.status, `ESPN scoreboard request failed (HTTP ${res.status}).`);
    return res.json();
  });
  return (raw.events ?? []).map(normalizeEvent);
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
): Promise<{ team: string; games: H2HGame[] }> {
  // Separate cache key from getMatchStats (which also hits /summary on a short
  // TTL) — a shared key would let the shorter TTL win and refetch H2H needlessly.
  const raw = await cached<any>(`espn_h2h_${eventId}`, ttlMs, async () => {
    const res = await fetch(`${BASE}/summary?event=${eventId}`);
    if (!res.ok) throw new ApiError(res.status, `ESPN summary request failed (HTTP ${res.status}).`);
    return res.json();
  });
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
  homeAbbr: string;
  awayAbbr: string;
  homeScore: string;
  awayScore: string;
  possession?: [string, string];
  shots?: [string, string];
  onTarget?: [string, string];
}

/** Fresh live state for one match in a single call: clock + score (summary
 *  header) and stats (boxscore). Short TTL — this drives the live overlay. */
export async function getLiveMatch(eventId: string, ttlMs = 5_000): Promise<LiveMatch | null> {
  const raw = await cached<any>(`espn_live_${eventId}`, ttlMs, async () => {
    const res = await fetch(`${BASE}/summary?event=${eventId}`);
    if (!res.ok) throw new ApiError(res.status, `ESPN summary request failed (HTTP ${res.status}).`);
    return res.json();
  });
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
  return {
    detail: comp.status?.type?.shortDetail ?? "",
    homeAbbr: hc?.team?.abbreviation ?? "?",
    awayAbbr: ac?.team?.abbreviation ?? "?",
    homeScore: String(hc?.score ?? "0"),
    awayScore: String(ac?.score ?? "0"),
    possession: pair("possessionPct"),
    shots: pair("totalShots"),
    onTarget: pair("shotsOnTarget"),
  };
}

/** Per-team statistics for one event (from the summary boxscore). */
export async function getMatchStats(eventId: string, ttlMs = 60_000): Promise<EspnTeamStats[]> {
  const raw = await cached<any>(`espn_sum_${eventId}`, ttlMs, async () => {
    const res = await fetch(`${BASE}/summary?event=${eventId}`);
    if (!res.ok) throw new ApiError(res.status, `ESPN summary request failed (HTTP ${res.status}).`);
    return res.json();
  });
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
