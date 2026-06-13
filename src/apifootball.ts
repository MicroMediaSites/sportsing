// API-Football (api-sports.io) client — richer per-match data (statistics,
// lineups, head-to-head) than football-data.org's free tier provides. Used by
// the stats/predict commands. Mirrors the cache + key pattern in api.ts and
// reuses its disk cache.
//
// Direct api-sports.io host (NOT the RapidAPI variant, which uses different
// host + headers). Key via `sportsball fifa setup apifootball <key>` or the
// API_FOOTBALL_KEY env var. Free tier: 100 requests/day — caching matters.

import { cached, ApiError } from "./api.ts";
import { getApiFootballKey } from "./config.ts";

const BASE = "https://v3.football.api-sports.io";

/** FIFA World Cup competition id in API-Football. */
export const WORLD_CUP_LEAGUE = 1;
/** Tournament season (the year the cup is played). */
export const SEASON = 2026;

/** Thrown when no API-Football key is configured (distinct from football-data's NoKeyError). */
export class NoApiFootballKeyError extends Error {}

// API-Football wraps every payload: { response: [...], errors, results, ... }.
interface Envelope<T> {
  response: T[];
  results: number;
  errors: unknown;
}

export interface AfTeam {
  id: number;
  name: string;
  logo?: string;
}

export interface AfFixture {
  fixture: { id: number; date: string; status: { short: string; long: string; elapsed: number | null } };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
}

/** One team's stats for a fixture: a flat list of {type, value} rows. */
export interface AfTeamStatistics {
  team: AfTeam;
  statistics: { type: string; value: number | string | null }[];
}

async function get<T>(path: string, ttlMs: number): Promise<Envelope<T>> {
  const key = await getApiFootballKey();
  if (!key) throw new NoApiFootballKeyError();

  // encodeURIComponent so the key is a single filename-safe segment — `path`
  // contains '/', '?', '&', '=' which would otherwise make `join(CACHE_DIR, key)`
  // resolve into an uncreated subdir and silently fail every cache write.
  return cached<Envelope<T>>(`apifootball_${encodeURIComponent(path)}`, ttlMs, async () => {
    const res = await fetch(BASE + path, { headers: { "x-apisports-key": key } });
    if (res.status === 429) {
      throw new ApiError(429, "API-Football rate limit reached (free tier = 100/day). Try later.");
    }
    if (!res.ok) {
      throw new ApiError(res.status, `API-Football request failed (HTTP ${res.status}).`);
    }
    const body = (await res.json()) as Envelope<T>;
    // API-Football returns 200 with a non-empty `errors` object for auth/quota
    // problems rather than an HTTP error code — surface those.
    if (body.errors && !Array.isArray(body.errors) && Object.keys(body.errors).length > 0) {
      throw new ApiError(400, `API-Football error: ${JSON.stringify(body.errors)}`);
    }
    return body;
  });
}

/** Validate a key against /status (used by setup). Returns true if the key works. */
export async function validateKey(key: string): Promise<boolean> {
  const res = await fetch(BASE + "/status", { headers: { "x-apisports-key": key } });
  if (!res.ok) return false;
  const body = (await res.json()) as Envelope<unknown>;
  return !(body.errors && !Array.isArray(body.errors) && Object.keys(body.errors).length > 0);
}

/** World Cup fixtures, optionally narrowed by team id. TTL long (schedule is stable). */
export async function getFixtures(teamId?: number, ttlMs = 60 * 60_000): Promise<AfFixture[]> {
  const q = `?league=${WORLD_CUP_LEAGUE}&season=${SEASON}` + (teamId ? `&team=${teamId}` : "");
  return (await get<AfFixture>(`/fixtures${q}`, ttlMs)).response;
}

/** Per-team statistics for a single fixture (possession, shots, etc.). */
export async function getFixtureStatistics(fixtureId: number, ttlMs = 5 * 60_000): Promise<AfTeamStatistics[]> {
  return (await get<AfTeamStatistics>(`/fixtures/statistics?fixture=${fixtureId}`, ttlMs)).response;
}
