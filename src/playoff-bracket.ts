// Playoff brackets for ESPN-backed leagues (NBA, NHL): grouping postseason
// games into series, ordering them as a bracket, projecting a bracket from
// standings before the postseason, and rendering both. Pure — every fetch
// happens in the command (src/commands/league-bracket.ts) — so it's unit-tested
// without network.
//
// Formats are keyed by ESPN league path, like standings.ts's layouts: they
// describe each league's postseason shape, not anything about the CLI.

import { c, pad } from "./ansi.ts";
import { LEAGUES, type Conference, type EspnStandingsEntry, type EspnStandingsGroup, type League, type PlayoffGame } from "./espn.ts";
import { fmtDate } from "./format.ts";
import type { Game } from "./game.ts";
import { sortEntries } from "./standings.ts";

export interface BracketFormat {
  /** How a bracket is projected from standings (and which standings level it
   *  needs: NBA conference tables, NHL division tables). */
  projection: "nba" | "nhl";
  /** Whether the league has a play-in (ESPN season type 5) to fetch and show. */
  playIn: boolean;
  /** Round names, first round → league final. */
  rounds: [string, string, string, string];
  /** Wins needed to take a series (every round is best-of-7 in both leagues). */
  winsNeeded: number;
  /** Standings stat the projection ranks by, as in the standings view. */
  rankBy: string;
}

export const BRACKET_FORMATS: Partial<Record<League, BracketFormat>> = {
  [LEAGUES.nba]: {
    projection: "nba",
    playIn: true,
    rounds: ["First Round", "Conference Semifinals", "Conference Finals", "NBA Finals"],
    winsNeeded: 4,
    rankBy: "winPercent",
  },
  [LEAGUES.nhl]: {
    projection: "nhl",
    playIn: false,
    rounds: ["First Round", "Second Round", "Conference Final", "Stanley Cup Final"],
    winsNeeded: 4,
    rankBy: "points",
  },
};

/**
 * `--season` input → ESPN season year (the year the season ends): "2026" or
 * "2025-26" → 2026. Null if it's neither.
 */
export function parseSeasonArg(input: string): number | null {
  const q = input.trim();
  if (/^\d{4}$/.test(q)) return Number(q);
  const m = /^(\d{4})-(\d{2})$/.exec(q);
  if (!m) return null;
  const start = Number(m[1]);
  return (start + 1) % 100 === Number(m[2]) ? start + 1 : null;
}

/** ESPN season year → display name, e.g. 2026 → "2025-26". */
export function seasonLabel(year: number): string {
  return `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}

const CONFERENCES: Conference[] = ["East", "West"];
const CONFERENCE_NAMES: Record<Conference, string> = { East: "Eastern Conference", West: "Western Conference" };

/** "Eastern Conference" / "East" / "Eastern" → East; null if neither. */
export function conferenceOf(name: string): Conference | null {
  const q = name.trim().toLowerCase();
  if (q.startsWith("east")) return "East";
  if (q.startsWith("west")) return "West";
  return null;
}

// ── Series (the postseason itself) ───────────────────────────────────────────

export interface SeriesTeam {
  id: string;
  name: string;
  abbreviation: string;
  /** Seed label, e.g. "1"; "" when unknown. */
  seed: string;
  wins: number;
}

export interface Series {
  round: number;
  conference: Conference | null;
  /** Higher seed first (home in game 1). */
  teams: [SeriesTeam, SeriesTeam];
  /** The series' games, oldest first. */
  games: Game[];
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/** Winner's team id of a finished game; null if not final or level. */
export function gameWinner(g: Game): string | null {
  if (g.state !== "post") return null;
  const h = Number(g.home.score);
  const a = Number(g.away.score);
  if (!Number.isFinite(h) || !Number.isFinite(a) || h === a) return null;
  return h > a ? g.home.id : g.away.id;
}

/**
 * Group postseason games (play-in excluded) into series: one per pair of team
 * ids, wins counted from finished games. Game-one home team is listed first —
 * that's the higher seed. Duplicates (the same game from both teams'
 * schedules) count once; games with an unknown side (TBD) are skipped.
 */
export function buildSeries(games: PlayoffGame[], seeds: ReadonlyMap<string, string>): Series[] {
  const byPair = new Map<string, { pg: PlayoffGame; games: Map<string, Game> }>();
  for (const pg of games) {
    const g = pg.game;
    if (pg.playIn || pg.round === null || !g.home.id || !g.away.id) continue;
    const key = pairKey(g.home.id, g.away.id);
    const entry = byPair.get(key) ?? byPair.set(key, { pg, games: new Map() }).get(key)!;
    entry.games.set(g.id, g);
  }
  return [...byPair.values()].map(({ pg, games: byId }) => {
    const list = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const first = list[0]!;
    const team = (side: Game["home"]): SeriesTeam => ({
      id: side.id,
      name: side.name,
      abbreviation: side.abbreviation,
      seed: seeds.get(side.id) ?? "",
      wins: list.filter((g) => gameWinner(g) === side.id).length,
    });
    return { round: pg.round!, conference: pg.conference, teams: [team(first.home), team(first.away)], games: list };
  });
}

/** Finished series' winner, else null. */
export function seriesWinner(s: Series, winsNeeded: number): SeriesTeam | null {
  return s.teams.find((t) => t.wins >= winsNeeded) ?? null;
}

/** "OKC wins 4-0", "NY leads 3-1", "Tied 2-2", "Not started". */
export function seriesStatus(s: Series, winsNeeded: number): string {
  const [a, b] = s.teams;
  const w = seriesWinner(s, winsNeeded);
  const label = (t: SeriesTeam) => t.abbreviation || t.name;
  if (w) {
    const l = w === a ? b : a;
    return `${label(w)} wins ${w.wins}-${l.wins}`;
  }
  if (a.wins === 0 && b.wins === 0) return "Not started";
  if (a.wins === b.wins) return `Tied ${a.wins}-${b.wins}`;
  const [lead, trail] = a.wins > b.wins ? [a, b] : [b, a];
  return `${label(lead)} leads ${lead.wins}-${trail.wins}`;
}

const seedNum = (t: SeriesTeam) => Number(t.seed) || Infinity;
const bestSeed = (s: Series) => Math.min(...s.teams.map(seedNum));

/**
 * Order one conference's (or the final's) series as a bracket: the latest round
 * by best seed, then each earlier round by following every team back to the
 * series it came from, so the two series that feed a later one sit together.
 * Series no later round reaches fall in after, by best seed.
 */
export function bracketOrder(series: Series[]): Series[] {
  const rounds = [...new Set(series.map((s) => s.round))].sort((a, b) => b - a);
  const out: Series[] = [];
  let later: Series[] = [];
  for (const r of rounds) {
    const inRound = series.filter((s) => s.round === r).sort((a, b) => bestSeed(a) - bestSeed(b));
    const ordered: Series[] = [];
    for (const parent of later) {
      for (const t of parent.teams) {
        const feeder = inRound.find((s) => !ordered.includes(s) && s.teams.some((x) => x.id === t.id));
        if (feeder) ordered.push(feeder);
      }
    }
    for (const s of inRound) if (!ordered.includes(s)) ordered.push(s);
    out.unshift(...ordered);
    later = ordered;
  }
  return out.sort((a, b) => a.round - b.round);
}

// ── Projection (before the postseason) ───────────────────────────────────────

export interface Slot {
  /** Seed label, e.g. "1", "WC2", "C3". */
  seed: string;
  /** Null for a slot decided later (an NBA play-in winner). */
  team: EspnStandingsEntry | null;
  /** Shown instead of a team, e.g. "Play-in winner". */
  placeholder?: string;
}

export interface ProjectedConference {
  conference: Conference;
  /** First-round matchups in bracket order (adjacent pairs meet next round). */
  matchups: [Slot, Slot][];
  /** NBA play-in games (7 v 8, 9 v 10); empty for the NHL. */
  playIn: [Slot, Slot][];
}

const slot = (seed: string, team: EspnStandingsEntry): Slot => ({ seed, team });

/**
 * NBA: per conference, rank by record (seed breaks ties); 1-6 are in, 7-10 go
 * to the play-in (7 v 8 for the 7 seed, 9 v 10 for a shot at the 8 seed).
 * First round in bracket order: 1 v 8, 4 v 5, 3 v 6, 2 v 7. `groups` are
 * conference tables.
 */
export function projectNba(groups: EspnStandingsGroup[], rankBy: string): ProjectedConference[] {
  const out: ProjectedConference[] = [];
  for (const conference of CONFERENCES) {
    const g = groups.find((x) => conferenceOf(x.name) === conference);
    if (!g) continue;
    const ranked = sortEntries(g.entries, rankBy);
    if (ranked.length < 10) continue;
    const s = (n: number) => slot(String(n), ranked[n - 1]!);
    const tbd = (n: number): Slot => ({ seed: String(n), team: null, placeholder: "Play-in winner" });
    out.push({
      conference,
      matchups: [
        [s(1), tbd(8)],
        [s(4), s(5)],
        [s(3), s(6)],
        [s(2), tbd(7)],
      ],
      playIn: [
        [s(7), s(8)],
        [s(9), s(10)],
      ],
    });
  }
  return out;
}

/**
 * NHL: per conference, the top three of each division plus two wild cards (the
 * next-best two in the conference). The better division winner plays WC2, the
 * other WC1; second and third in each division meet. `groups` are division
 * tables whose `parent` is the conference. Seeds are labelled by division
 * initial ("C1") or wild card ("WC1").
 */
export function projectNhl(groups: EspnStandingsGroup[], rankBy: string): ProjectedConference[] {
  const out: ProjectedConference[] = [];
  for (const conference of CONFERENCES) {
    const divisions = groups
      .filter((g) => g.parent && conferenceOf(g.parent.name) === conference)
      .map((g) => ({ g, ranked: sortEntries(g.entries, rankBy) }));
    if (divisions.length !== 2 || divisions.some((d) => d.ranked.length < 3)) continue;
    const qualified = new Set(divisions.flatMap((d) => d.ranked.slice(0, 3).map((e) => e.teamId)));
    const rest = sortEntries(
      divisions.flatMap((d) => d.ranked.filter((e) => !qualified.has(e.teamId))),
      rankBy,
    );
    if (rest.length < 2) continue;
    const winners = sortEntries(divisions.map((d) => d.ranked[0]!), rankBy);
    const ordered = winners.map((w) => divisions.find((d) => d.ranked[0] === w)!);
    const wildcards = [slot("WC1", rest[0]!), slot("WC2", rest[1]!)];
    const matchups: [Slot, Slot][] = [];
    ordered.forEach((d, i) => {
      const initial = (d.g.name.trim()[0] ?? "?").toUpperCase();
      const s = (n: number) => slot(`${initial}${n}`, d.ranked[n - 1]!);
      matchups.push([s(1), wildcards[1 - i]!], [s(2), s(3)]);
    });
    out.push({ conference, matchups, playIn: [] });
  }
  return out;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const NAME_W = 26;

function teamCell(name: string, seed: string, fav: boolean): string {
  const label = `${seed ? `(${seed}) ` : ""}${name}`;
  return fav ? c.bold(c.yellow(`★ ${label}`)) : `  ${label}`;
}

function slotCell(s: Slot, favoriteIds: ReadonlySet<string>): string {
  if (!s.team) return c.dim(`  (${s.seed}) ${s.placeholder ?? "TBD"}`);
  return teamCell(s.team.team, s.seed, favoriteIds.has(s.team.teamId));
}

function matchupLine(a: string, b: string): string {
  return "    " + pad(a, NAME_W + 2) + c.dim(" vs ") + b;
}

function seriesLine(s: Series, fmt: BracketFormat, favoriteIds: ReadonlySet<string>, now: number): string {
  const [a, b] = s.teams;
  const winner = seriesWinner(s, fmt.winsNeeded);
  const cell = (t: SeriesTeam) => {
    const txt = teamCell(t.name, t.seed, favoriteIds.has(t.id));
    return winner && winner !== t ? c.dim(txt) : txt;
  };
  const mark = winner ? c.green("✓") : c.dim("·");
  let tail = seriesStatus(s, fmt.winsNeeded);
  if (!winner) {
    const live = s.games.find((g) => g.state === "in");
    const next = s.games.find((g) => g.state === "pre" && Date.parse(g.date) >= now);
    if (live) tail += ` · ${c.red("LIVE")} ${live.away.abbreviation} ${live.away.score}-${live.home.score} ${live.home.abbreviation}`;
    else if (next) tail += ` · Game ${s.games.indexOf(next) + 1} ${fmtDate(next.date)}`;
  }
  const score = c.bold(`${a.wins}-${b.wins}`);
  return `  ${mark} ` + pad(cell(a), NAME_W + 2) + " " + pad(score, 5) + " " + pad(cell(b), NAME_W + 2) + " " + c.dim(tail);
}

function playInLine(pg: PlayoffGame, favoriteIds: ReadonlySet<string>): string {
  const g = pg.game;
  const cell = (t: Game["home"]) => teamCell(t.name, "", favoriteIds.has(t.id));
  const score = g.state === "pre" ? c.dim(fmtDate(g.date)) : c.bold(`${g.away.score}-${g.home.score}`);
  const w = gameWinner(g);
  const mark = w ? c.green("✓") : g.state === "in" ? c.red("●") : c.dim("·");
  return `  ${mark} ` + pad(cell(g.away), NAME_W + 2) + " @ " + pad(cell(g.home), NAME_W + 2) + " " + score + "  " + c.dim(pg.label);
}

/**
 * Render a postseason in progress (or finished): the NBA play-in, then each
 * conference's rounds, then the league final. Series in bracket order; series
 * scores, the winner ticked, and the next game or live score for open series.
 */
export function renderBracket(
  fmt: BracketFormat,
  series: Series[],
  playIn: PlayoffGame[],
  favoriteIds: ReadonlySet<string>,
  now = Date.now(),
): string {
  const lines: string[] = [];
  if (playIn.length > 0) {
    lines.push("", c.bold(c.cyan("Play-In")));
    for (const conference of [...CONFERENCES, null]) {
      const games = playIn
        .filter((pg) => pg.conference === conference)
        .sort((a, b) => Date.parse(a.game.date) - Date.parse(b.game.date));
      if (games.length === 0) continue;
      lines.push(c.bold(`  ${conference ? CONFERENCE_NAMES[conference] : "Other"}`));
      for (const pg of games) lines.push("  " + playInLine(pg, favoriteIds));
    }
  }
  // Conference rounds under their conference (round headings shown); the
  // league final on its own; anything ESPN didn't tag with a conference under
  // "Other" rather than dropped.
  const conferenceRound = (s: Series) => s.round < 4;
  const sections: [string, Series[], boolean][] = [
    ...CONFERENCES.map((conf): [string, Series[], boolean] => [
      CONFERENCE_NAMES[conf],
      series.filter((s) => s.conference === conf && conferenceRound(s)),
      true,
    ]),
    ["Other", series.filter((s) => s.conference === null && conferenceRound(s)), true],
    [fmt.rounds[3], series.filter((s) => !conferenceRound(s)), false],
  ];
  for (const [heading, list, showRounds] of sections) {
    if (list.length === 0) continue;
    lines.push("", c.bold(c.cyan(heading)));
    let round = 0;
    for (const s of bracketOrder(list)) {
      if (showRounds && s.round !== round) {
        round = s.round;
        lines.push(c.bold(`  ${fmt.rounds[round - 1] ?? `Round ${round}`}`));
      }
      lines.push("  " + seriesLine(s, fmt, favoriteIds, now));
    }
  }
  return lines.join("\n");
}

/** Render a projected bracket: per conference, the play-in (NBA) and the
 *  first-round matchups in bracket order. */
export function renderProjection(fmt: BracketFormat, conferences: ProjectedConference[], favoriteIds: ReadonlySet<string>): string {
  const lines: string[] = [];
  for (const p of conferences) {
    lines.push("", c.bold(c.cyan(CONFERENCE_NAMES[p.conference])));
    if (p.playIn.length > 0) {
      lines.push(c.bold("  Play-In"));
      for (const [a, b] of p.playIn) lines.push(matchupLine(slotCell(a, favoriteIds), slotCell(b, favoriteIds)));
    }
    lines.push(c.bold(`  ${fmt.rounds[0]}`));
    for (const [a, b] of p.matchups) lines.push(matchupLine(slotCell(a, favoriteIds), slotCell(b, favoriteIds)));
  }
  return lines.join("\n");
}
