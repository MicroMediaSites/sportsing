// Bare `sportsing today | next | me` — your favorite teams' games across every
// registered sport, each row tagged with its sport. Any other bare command is
// per-sport: it gets a hint naming the sports that have it, never a silent
// fallback to one sport.
//
// SPORTS below is the one sport registry: src/index.ts builds its
// `sportsing <sport> …` namespaces from it, so a new sport is aggregated here
// as soon as it's routable.

import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { getFavorites } from "../config.ts";
import { getTeams } from "../espn.ts";
import { fmtDate, gameLine, matchLine, relativeTime } from "../format.ts";
import type { GameState } from "../game.ts";
import { fifa, fifaHasCommand } from "../sports/fifa.ts";
import { NBA, nba } from "../sports/nba.ts";
import { NHL, nhl } from "../sports/nhl.ts";
import type { Match } from "../types.ts";
import { EXAMPLE_TEAM, addDays, localDateOf, matchHasTeam, withFallback, ymd } from "./_lib.ts";
import {
  favoriteIds,
  gameHasTeam,
  gamesOnDays,
  leagueHasCommand,
  parseOffset,
  teamSeason,
  type LeagueConfig,
} from "./league.ts";

/** One game, sport-neutral: enough to sort, pick, and print it. */
export interface Row {
  id: string;
  /** ISO start time. */
  start: string;
  state: GameState;
  /** The sport's own aligned game line. */
  line: string;
}

/** One favorite team and its games, ascending by start. */
export interface TeamRows {
  team: string;
  rows: Row[];
}

export interface Sport {
  /** CLI namespace and favorites key, e.g. "nba". */
  key: string;
  label: string;
  icon: string;
  /** `sportsing <key> …` dispatcher. */
  run: (args: string[]) => unknown | Promise<unknown>;
  /** True if `sportsing <key> <cmd>` exists. */
  has: (cmd: string) => boolean;
  /** Favorite teams' games on one local day; null when the sport has no favorites. */
  favoritesOn: (day: Date) => Promise<Row[] | null>;
  /** Each favorite team's schedule; null when the sport has no favorites. */
  favoriteTeams: () => Promise<TeamRows[] | null>;
}

// ── FIFA (football-data `Match`) ─────────────────────────────────────────────

/** A football-data match status as a sport-neutral game state. */
export function matchState(m: Pick<Match, "status">): GameState {
  if (m.status === "IN_PLAY" || m.status === "PAUSED") return "in";
  if (m.status === "FINISHED" || m.status === "AWARDED") return "post";
  return "pre";
}

const matchRow = (m: Match): Row => ({ id: String(m.id), start: m.utcDate, state: matchState(m), line: matchLine(m) });

const allMatches = () =>
  withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

const FIFA: Sport = {
  key: "fifa",
  label: "FIFA",
  icon: "⚽",
  run: fifa,
  has: fifaHasCommand,
  async favoritesOn(day) {
    const favs = await getFavorites("fifa");
    if (favs.length === 0) return null;
    // football-data filters by UTC date; fetch ±1 day and keep the local day.
    const date = ymd(day);
    const onDay = (all: Match[]) => all.filter((m) => localDateOf(m.utcDate) === date);
    const matches = await withFallback(
      async () => onDay((await getMatches({ dateFrom: ymd(addDays(day, -1)), dateTo: ymd(addDays(day, 1)) })).matches),
      onDay,
    );
    const needles = favs.map((f) => f.toLowerCase());
    return matches.filter((m) => needles.some((n) => matchHasTeam(m, n))).map(matchRow);
  },
  async favoriteTeams() {
    const favs = await getFavorites("fifa");
    if (favs.length === 0) return null;
    const matches = (await allMatches()).map((m) => ({ m, row: matchRow(m) }));
    return favs.map((team) => ({
      team,
      rows: matches
        .filter(({ m }) => matchHasTeam(m, team.toLowerCase()))
        .map(({ row }) => row)
        .sort(byStart),
    }));
  },
};

// ── ESPN leagues (sport-neutral `Game`) ──────────────────────────────────────

function league(cfg: LeagueConfig, run: Sport["run"]): Sport {
  const favoriteTeamsOf = async () => {
    const favs = await getFavorites(cfg.sport);
    if (favs.length === 0) return null;
    const teams = await getTeams(cfg.league);
    return { teams, ids: favoriteIds(cfg, teams, favs) };
  };
  return {
    key: cfg.sport,
    label: cfg.label,
    icon: cfg.icon,
    run,
    has: leagueHasCommand,
    async favoritesOn(day) {
      const favs = await favoriteTeamsOf();
      if (!favs) return null;
      const games = await gamesOnDays(cfg, day, 1);
      return games
        .filter((g) => gameHasTeam(g, favs.ids))
        .map((g) => ({ id: g.id, start: g.date, state: g.state, line: gameLine(g, cfg.periods) }));
    },
    async favoriteTeams() {
      const favs = await favoriteTeamsOf();
      if (!favs) return null;
      return Promise.all(
        [...favs.ids].map(async (id) => ({
          team: favs.teams.find((t) => t.id === id)!.name,
          rows: (await teamSeason(cfg, id)).map((g) => ({
            id: g.id,
            start: g.date,
            state: g.state,
            line: gameLine(g, cfg.periods),
          })),
        })),
      );
    },
  };
}

/** Every registered sport, in display order. */
export const SPORTS: Sport[] = [FIFA, league(NBA, nba), league(NHL, nhl)];

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

const byStart = (a: Row, b: Row) => Date.parse(a.start) - Date.parse(b.start);

/** A sport tag + the game line, e.g. "🏀 NBA   UTAH  @  DEN …". */
export function tagged(sport: Pick<Sport, "icon" | "label">, line: string): string {
  return `${sport.icon} ${c.bold(sport.label.padEnd(4))}  ${line}`;
}

/** A team's most recent finished game and its next not-yet-started one. */
export function lastAndNext(rows: Row[], now: number): { last: Row | null; next: Row | null } {
  const sorted = [...rows].sort(byStart);
  return {
    last: sorted.filter((r) => r.state === "post").at(-1) ?? null,
    next: sorted.find((r) => r.state === "pre" && Date.parse(r.start) >= now) ?? null,
  };
}

/** Each team's next game, one copy per game (two favorites can meet), soonest first. */
export function nextPerTeam(teams: TeamRows[], now: number): Row[] {
  const byId = new Map<string, Row>();
  for (const t of teams) {
    const n = lastAndNext(t.rows, now).next;
    if (n) byId.set(n.id, n);
  }
  return [...byId.values()].sort(byStart);
}

/**
 * What to say for a bare command that can't run cross-sport: the per-sport
 * forms of it (args kept), or "unknown" if no sport has it. `optionsGiven`
 * marks a cross-sport command whose options only make sense per sport.
 */
export function bareHint(cmd: string, args: string[], sports: Pick<Sport, "key" | "has">[], optionsGiven = false): string[] {
  const forms = sports.filter((s) => s.has(cmd)).map((s) => ["sportsing", s.key, cmd, ...args].join(" "));
  if (forms.length === 0) return [`Unknown command: ${cmd}`, "Run `sportsing help` for usage."];
  const why = optionsGiven ? `Bare \`${cmd}\` takes no options — add a sport:` : `\`${cmd}\` needs a sport:`;
  return [why, "  " + forms.join(" · ")];
}

/** "Add a favorite" hint, one example per sport. */
export function noFavoritesHint(sports: Pick<Sport, "key">[]): string[] {
  const examples = sports.map((s) => `sportsing ${s.key} fav add ${EXAMPLE_TEAM[s.key] ?? "<team>"}`);
  return [
    c.dim("No favorite teams yet — add one with ") + c.bold("sportsing <sport> fav add <team>"),
    c.dim("  e.g. " + examples.join(" · ")),
  ];
}

// ── Commands ─────────────────────────────────────────────────────────────────

/**
 * Run `load` for every sport. A sport that fails is reported and skipped (and
 * the exit code set) so the others still print; sports with no favorites
 * (null) are dropped. Null — after printing the add-a-favorite hint — when no
 * sport has favorites at all.
 */
async function perSport<T>(sports: Sport[], load: (s: Sport) => Promise<T | null>): Promise<{ sport: Sport; data: T }[] | null> {
  const settled = await Promise.allSettled(sports.map(load));
  const out: { sport: Sport; data: T }[] = [];
  let failed = false;
  settled.forEach((r, i) => {
    const sport = sports[i]!;
    if (r.status === "rejected") {
      failed = true;
      console.error(c.yellow(`Couldn't load ${sport.label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));
      process.exitCode = 1;
    } else if (r.value !== null) {
      out.push({ sport, data: r.value });
    }
  });
  if (out.length === 0 && !failed) {
    for (const l of noFavoritesHint(sports)) console.log(l);
    return null;
  }
  return out;
}

/** `today [--tomorrow|--yesterday|--offset N]` — your teams' games on one local day. */
export async function today(sports: Sport[], args: string[]): Promise<void> {
  const offset = parseOffset(args);
  const day = addDays(new Date(), offset);
  const loaded = await perSport(sports, (s) => s.favoritesOn(day));
  if (!loaded) return;
  const rows = loaded
    .flatMap(({ sport, data }) => data.map((row) => ({ sport, row })))
    .sort((a, b) => byStart(a.row, b.row));

  const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : ymd(day);
  console.log(c.bold(c.cyan(`★ Your teams — ${label} (${ymd(day)})`)));
  if (rows.length === 0) {
    console.log(c.dim("\nNo games for your teams."));
    return;
  }
  console.log();
  for (const { sport, row } of rows) console.log("  " + tagged(sport, row.line));
}

/** `next` — each favorite team's next game, soonest first, with countdowns. */
export async function next(sports: Sport[]): Promise<void> {
  const loaded = await perSport(sports, (s) => s.favoriteTeams());
  if (!loaded) return;
  const now = Date.now();
  const rows = loaded
    .flatMap(({ sport, data }) => nextPerTeam(data, now).map((row) => ({ sport, row })))
    .sort((a, b) => byStart(a.row, b.row));

  console.log(c.bold(c.cyan("★ Your teams — Next up")));
  if (rows.length === 0) {
    console.log(c.dim("\nNo upcoming games for your teams."));
    return;
  }
  for (const { sport, row } of rows) {
    console.log("\n  " + tagged(sport, row.line));
    console.log(`  ${c.bold(fmtDate(row.start))}  ${c.green("— starts " + relativeTime(row.start))}`);
  }
}

/** `me` — every favorite team, every sport: last result and next game. */
export async function me(sports: Sport[]): Promise<void> {
  const loaded = await perSport(sports, (s) => s.favoriteTeams());
  if (!loaded) return;
  const now = Date.now();

  console.log(c.bold(c.cyan("★ My teams")));
  for (const { sport, data } of loaded) {
    for (const t of data) {
      const { last, next } = lastAndNext(t.rows, now);
      console.log("\n" + `${sport.icon} ${c.bold(t.team)} ${c.dim(sport.label)}`);
      if (last) console.log("  " + c.dim("last ") + last.line);
      if (next) console.log("  " + c.dim("next ") + next.line + c.green("  " + relativeTime(next.start)));
      if (!last && !next) console.log(c.dim("  no games found"));
    }
  }
}

/** Dispatch a bare `sportsing <cmd> …` (no sport prefix). */
export async function bare(cmd: string, args: string[]): Promise<void> {
  if (cmd === "today" || cmd === "t") return today(SPORTS, args);
  const run = cmd === "next" || cmd === "n" ? next : cmd === "me" ? me : null;
  if (run && args.length === 0) return run(SPORTS);
  // Options on `next`/`me` (e.g. `--team`) are per-sport: say so rather than ignore them.
  const [first, ...rest] = bareHint(cmd, args, SPORTS, run !== null);
  console.error(c.red(first!));
  for (const l of rest) console.error(c.dim(l));
  process.exitCode = 1;
}
