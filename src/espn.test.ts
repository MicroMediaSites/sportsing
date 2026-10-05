import { test, expect } from "bun:test";
import {
  looksOff,
  looksOffTeams,
  looksOffStandings,
  espnUrl,
  espnCacheKey,
  normalizeEvent,
  parseTeams,
  parseStandings,
  LEAGUES,
  FIFA,
} from "./espn.ts";

// Minimal scoreboard-event shapes, just the fields looksOff inspects.
const liveEvent = (competitors: any[]) => ({
  competitions: [{ status: { type: { state: "in" } }, competitors }],
});
const preEvent = () => ({
  competitions: [{ status: { type: { state: "pre" } }, competitors: [] }],
});
const namedTeams = [{ team: { displayName: "United States" } }, { team: { name: "England" } }];

test("a well-formed scoreboard with a live match is fine", () => {
  expect(looksOff({ events: [liveEvent(namedTeams)] })).toBe(false);
});

test("a date with no matches (events: []) is NOT off — empty ≠ wrong", () => {
  expect(looksOff({ events: [] })).toBe(false);
});

test("a pre-kickoff match with no stats yet is NOT off (shape, not emptiness)", () => {
  expect(looksOff({ events: [preEvent()] })).toBe(false);
});

test("missing `events` key is off (the shape changed)", () => {
  expect(looksOff({})).toBe(true);
});

test("`events` present but not an array is off", () => {
  expect(looksOff({ events: { nope: true } })).toBe(true);
});

test("non-object / null responses are off", () => {
  expect(looksOff(null)).toBe(true);
  expect(looksOff("a string")).toBe(true);
});

test("an in-play match with zero competitors is off", () => {
  expect(looksOff({ events: [liveEvent([])] })).toBe(true);
});

test("an in-play match with unnamed (\"?\") teams is off", () => {
  expect(looksOff({ events: [liveEvent([{ team: {} }, { team: {} }])] })).toBe(true);
});

test("only live matches are structurally enforced — a malformed pre event doesn't trip it", () => {
  // pre match with empty competitors is normal (teams may render as TBD); not off.
  expect(looksOff({ events: [preEvent(), liveEvent(namedTeams)] })).toBe(false);
});

// --- League parametrization (AGT-1600) ---

test("espnUrl builds per-league site/v2 URLs; FIFA is the default league", () => {
  expect(FIFA).toBe("soccer/fifa.world");
  expect(espnUrl(LEAGUES.fifa, "scoreboard?dates=20260611")).toBe(
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611",
  );
  expect(espnUrl(LEAGUES.nba, "teams/26/schedule?seasontype=1")).toBe(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/26/schedule?seasontype=1",
  );
  expect(espnUrl(LEAGUES.nhl, "teams")).toBe("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams");
});

test("cache keys include the league, so the same id never collides across leagues", () => {
  const keys = Object.values(LEAGUES).map((l) => espnCacheKey(l, "sched2", "UTAH"));
  expect(new Set(keys).size).toBe(3);
  expect(espnCacheKey(LEAGUES.nba, "sched2", "UTAH")).toBe("espn_basketball_nba_sched2_UTAH");
  expect(espnCacheKey(LEAGUES.fifa, "sb", "20260611-20260719")).toBe("espn_soccer_fifa_world_sb_20260611-20260719");
});

test("cache keys differ by season type and are filename-safe", () => {
  expect(espnCacheKey(LEAGUES.nba, "sched1", 26)).not.toBe(espnCacheKey(LEAGUES.nba, "sched3", 26));
  const k = espnCacheKey(LEAGUES.nhl, "live", "../../etc/passwd");
  expect(k).not.toContain("/");
  expect(k).not.toContain(".");
});

test("normalizeEvent flattens schedule-style object scores and null pre-game scores", () => {
  const e = normalizeEvent({
    id: 401891828,
    date: "2026-10-02T01:30Z",
    name: "Chicago Blackhawks at Utah Mammoth",
    competitions: [
      {
        status: { type: { state: "post", shortDetail: "Final" } },
        competitors: [
          { homeAway: "home", team: { displayName: "Utah Mammoth", abbreviation: "UTA" }, score: { value: 6, displayValue: "6" } },
          { homeAway: "away", team: { displayName: "Chicago Blackhawks", abbreviation: "CHI" }, score: null },
        ],
      },
    ],
  });
  expect(e.id).toBe("401891828");
  expect(e.state).toBe("post");
  expect(e.competitors.map((c) => c.score)).toEqual(["6", ""]);
});

test("normalizeEvent keeps scoreboard-style string scores unchanged (FIFA path)", () => {
  const e = normalizeEvent({
    id: "1",
    date: "2026-06-11T19:00Z",
    name: "Mexico v South Africa",
    competitions: [
      {
        status: { type: { state: "in", shortDetail: "45'" } },
        competitors: [{ homeAway: "home", team: { displayName: "Mexico", abbreviation: "MEX" }, score: "2" }],
      },
    ],
  });
  expect(e.competitors[0]).toEqual({ homeAway: "home", name: "Mexico", abbreviation: "MEX", score: "2" });
  expect(e.detail).toBe("45'");
});

test("looksOff applies to team-schedule responses too (same events shape)", () => {
  expect(looksOff({ team: { abbreviation: "UTAH" }, events: [] })).toBe(false);
  expect(looksOff({ team: { abbreviation: "UTAH" } })).toBe(true);
});

const teamsRaw = {
  sports: [
    {
      leagues: [
        {
          teams: [
            { team: { id: "26", abbreviation: "UTAH", displayName: "Utah Jazz", shortDisplayName: "Jazz", location: "Utah" } },
          ],
        },
      ],
    },
  ],
};

test("parseTeams / looksOffTeams", () => {
  expect(parseTeams(teamsRaw)).toEqual([
    { id: "26", abbreviation: "UTAH", name: "Utah Jazz", shortName: "Jazz", location: "Utah" },
  ]);
  expect(looksOffTeams(teamsRaw)).toBe(false);
  expect(looksOffTeams({ sports: [] })).toBe(true);
  expect(looksOffTeams({ sports: [{ leagues: [{ teams: [{ team: {} }] }] }] })).toBe(true);
});

const standingsRaw = {
  children: [
    {
      name: "Western Conference",
      abbreviation: "West",
      standings: {
        entries: [
          {
            team: { id: "129764", abbreviation: "UTA", displayName: "Utah Mammoth" },
            stats: [
              { name: "points", displayValue: "6" },
              { name: "gamesPlayed", displayValue: "4" },
            ],
          },
        ],
      },
    },
  ],
};

test("parseStandings / looksOffStandings", () => {
  expect(parseStandings(standingsRaw)).toEqual([
    {
      name: "Western Conference",
      abbreviation: "West",
      entries: [{ teamId: "129764", team: "Utah Mammoth", abbreviation: "UTA", stats: { points: "6", gamesPlayed: "4" } }],
    },
  ]);
  expect(looksOffStandings(standingsRaw)).toBe(false);
  // Offseason: groups present, tables empty — shape is fine.
  expect(looksOffStandings({ children: [{ name: "East", standings: { entries: [] } }] })).toBe(false);
  // The site/v2 stub (`fullViewLink` only) is drift for our purposes.
  expect(looksOffStandings({ fullViewLink: {} })).toBe(true);
  expect(looksOffStandings({ children: [{ standings: {} }] })).toBe(true);
});
