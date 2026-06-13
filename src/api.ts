import { join } from "path";
import { mkdir } from "fs/promises";
import { CACHE_DIR, getApiKey } from "./config.ts";
import type {
  MatchesResponse,
  StandingsResponse,
  ScorersResponse,
  Match,
} from "./types.ts";

const BASE = "https://api.football-data.org/v4";
const COMP = "WC"; // FIFA World Cup
const OPENFOOTBALL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class NoKeyError extends Error {}

/** Disk cache so we stay under the 10 req/min free-tier limit. Shared with espn.ts. */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, key + ".json");
  try {
    const stat = await Bun.file(file).stat();
    if (Date.now() - stat.mtimeMs < ttlMs) {
      return (await Bun.file(file).json()) as T;
    }
  } catch {
    /* miss */
  }
  const fresh = await fetcher();
  await Bun.write(file, JSON.stringify(fresh));
  return fresh;
}

async function get<T>(path: string): Promise<T> {
  const key = await getApiKey();
  if (!key) throw new NoKeyError();
  const res = await fetch(BASE + path, { headers: { "X-Auth-Token": key } });
  if (res.status === 429) {
    throw new ApiError(429, "Rate limited (free tier = 10 req/min). Try again shortly.");
  }
  if (res.status === 403) {
    throw new ApiError(403, "Forbidden — check your API key or plan.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as any).message ?? detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) sp.set(k, String(v));
  const s = sp.toString();
  return s ? "?" + s : "";
};

export interface MatchFilter {
  status?: string; // SCHEDULED,TIMED,IN_PLAY,...
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  stage?: string;
}

/** All matches, optionally filtered. TTL short so live scores stay fresh. */
export function getMatches(filter: MatchFilter = {}, ttlMs = 45_000): Promise<MatchesResponse> {
  const cacheKey =
    "matches_" +
    (Object.entries(filter)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}-${v}`)
      .join("_") || "all");
  return cached(cacheKey, ttlMs, () =>
    get<MatchesResponse>(`/competitions/${COMP}/matches${q({ ...filter })}`),
  );
}

export function getStandings(ttlMs = 5 * 60_000): Promise<StandingsResponse> {
  return cached("standings", ttlMs, () =>
    get<StandingsResponse>(`/competitions/${COMP}/standings`),
  );
}

export function getScorers(ttlMs = 10 * 60_000): Promise<ScorersResponse> {
  return cached("scorers", ttlMs, () =>
    get<ScorersResponse>(`/competitions/${COMP}/scorers?limit=20`),
  );
}

const ROUND_TO_STAGE: Record<string, Match["stage"]> = {
  "Round of 32": "LAST_32",
  "Round of 16": "LAST_16",
  "Quarter-final": "QUARTER_FINALS",
  "Semi-final": "SEMI_FINALS",
  "Match for third place": "THIRD_PLACE",
  Final: "FINAL",
};

/** Parse openfootball times like "13:00 UTC-6" into a true UTC ISO string. */
function offToUtcIso(date: string, time: string | undefined): string {
  if (!date) return new Date().toISOString();
  const m = (time ?? "").match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/);
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  if (!m) return new Date(Date.UTC(y, mo - 1, d, 0, 0)).toISOString();
  const hour = Number(m[1]);
  const min = Number(m[2]);
  const off = m[3] ? Number(m[3]) : 0; // local = UTC+off, so UTC = local - off
  return new Date(Date.UTC(y, mo - 1, d, hour - off, min)).toISOString();
}

const teamName = (t: any): string =>
  typeof t === "string" ? t : t?.name ?? "TBD";

/**
 * Keyless fallback: openfootball public-domain WC 2026 schedule.
 * Returns a Match[]-shaped array (fixtures only — no live scores / standings).
 */
export async function getOpenFootballMatches(): Promise<Match[]> {
  return cached("openfootball", 24 * 60 * 60_000, async () => {
    const res = await fetch(OPENFOOTBALL);
    if (!res.ok)
      throw new ApiError(
        res.status,
        "Could not fetch the offline fixture schedule — network unavailable. Run `sportsball setup` to add a free API key for live data.",
      );
    const data = (await res.json()) as any;
    const out: Match[] = [];
    let id = 1;
    for (const g of data.matches ?? []) {
      if (!g.team1 && !g.team2) continue;
      const groupLetter = g.group ? String(g.group).replace(/^Group\s+/i, "") : null;
      out.push({
        id: g.num ?? id++,
        utcDate: offToUtcIso(g.date, g.time),
        status: "SCHEDULED",
        stage: ROUND_TO_STAGE[g.round as string] ?? "GROUP_STAGE",
        group: groupLetter ? `GROUP_${groupLetter}` : null,
        matchday: null,
        homeTeam: { name: teamName(g.team1) },
        awayTeam: { name: teamName(g.team2) },
        score: { winner: null, fullTime: { home: null, away: null } },
        venue: g.ground ?? null,
      });
    }
    return out;
  });
}
