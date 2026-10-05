// The shared command set for ESPN-backed leagues (NBA, NHL, …). A league is
// pure configuration — its ESPN path, its favorites key, and display labels —
// so adding one is a `LeagueConfig` plus a src/sports/<sport>.ts that calls
// `leagueNamespace`. Nothing in here branches on a particular league.
//
// Teams are matched by ESPN team id, never abbreviation: abbreviations differ
// by endpoint (the Mammoth are UTAH in /teams but UTA on schedules). User input
// (`--team`, favorites) is resolved to a team via the league's /teams list.

import { c } from "../ansi.ts";
import { getScoreboardGames, getStandings, getTeamGames, getTeams, SEASON_TYPES, type EspnTeam, type League } from "../espn.ts";
import { fmtDate, fmtDayHeader, gameLine, relativeTime } from "../format.ts";
import type { Game } from "../game.ts";
import { PLAYOFF_FORMATS, renderSeasonSummary, summarizeSeason } from "../season.ts";
import { STANDINGS_LAYOUTS, groupMatches, loadStandingsView, renderStandingsTable, type StandingsLevel } from "../standings.ts";
import { getFavorites } from "../config.ts";
import { EXAMPLE_TEAM, addDays, getFlag, localDateOf, mineFavorites, noFavoritesHint, ymd } from "./_lib.ts";
import { fav } from "./fav.ts";

export interface LeagueConfig {
  /** CLI namespace and favorites key, e.g. "nba" (`sportsing nba …`, `nba:UTAH`). */
  sport: string;
  /** ESPN league path. */
  league: League;
  /** Display name, e.g. "NBA". */
  label: string;
  /** Header glyph, e.g. "🏀". */
  icon: string;
  /** Extra accepted team abbreviations → the ESPN /teams abbreviation
   *  (e.g. NBA.com's "UTA" → ESPN's "UTAH"). */
  aliases: Record<string, string>;
}

/** How far `schedule` looks ahead / `results` looks back league-wide, and how
 *  far `next` scans for a game, in days. ESPN date ranges are unreliable for
 *  NBA/NHL, so each day is its own (cached) scoreboard request. */
const WINDOW_DAYS = 7;
const NEXT_SCAN_DAYS = 14;

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Resolve user input to one of the league's teams: ESPN id, abbreviation, or a
 * configured alias (case-insensitive); then full name or nickname ("Utah Jazz",
 * "Jazz"); then location ("Utah") when exactly one team has it. Null if
 * nothing (or nothing unambiguous) matches.
 */
export function resolveTeam(teams: EspnTeam[], input: string, aliases: Record<string, string> = {}): EspnTeam | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const aliasOf = Object.entries(aliases).find(([k]) => k.toLowerCase() === q)?.[1]?.toLowerCase();
  const byCode = teams.find((t) => t.id === q || t.abbreviation.toLowerCase() === q || t.abbreviation.toLowerCase() === aliasOf);
  if (byCode) return byCode;
  const byName = teams.find((t) => t.name.toLowerCase() === q || t.shortName.toLowerCase() === q);
  if (byName) return byName;
  const byLocation = teams.filter((t) => t.location.toLowerCase() === q);
  return byLocation.length === 1 ? byLocation[0]! : null;
}

/** True if either side of `g` is one of the team ids. */
export function gameHasTeam(g: Game, ids: ReadonlySet<string>): boolean {
  return ids.has(g.home.id) || ids.has(g.away.id);
}

/** Merge game lists (e.g. several days, or several teams' schedules): one copy
 *  per game id, sorted by start time ascending. */
export function mergeGames(lists: Game[][]): Game[] {
  const byId = new Map<string, Game>();
  for (const list of lists) for (const g of list) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** ESPN scoreboard date (YYYYMMDD) for a local calendar day. */
export function espnDate(d: Date): string {
  return ymd(d).replace(/-/g, "");
}

/** The first not-yet-started game at or after `now` (input sorted ascending). */
export function firstUpcoming(games: Game[], now: number): Game | null {
  return games.find((g) => g.state === "pre" && Date.parse(g.date) >= now) ?? null;
}

/** Finished games, newest first. */
export function finishedNewestFirst(games: Game[]): Game[] {
  return games.filter((g) => g.state === "post").sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// ── Data access ──────────────────────────────────────────────────────────────

/** Every game for one team across preseason, regular season, and postseason. */
async function teamSeason(cfg: LeagueConfig, teamId: string): Promise<Game[]> {
  const { preseason, regular, postseason } = SEASON_TYPES;
  const lists = await Promise.all([preseason, regular, postseason].map((st) => getTeamGames(cfg.league, teamId, st)));
  return mergeGames(lists);
}

/** League-wide games on each local day in [from, from + days). ESPN groups
 *  scoreboards by US-Eastern day, so the days either side are fetched too and
 *  every game is re-bucketed by its local start date. */
async function gamesOnDays(cfg: LeagueConfig, from: Date, days: number): Promise<Game[]> {
  const fetchDays = Array.from({ length: days + 2 }, (_, i) => addDays(from, i - 1));
  const lists = await Promise.all(fetchDays.map((d) => getScoreboardGames(cfg.league, espnDate(d))));
  const wanted = new Set(Array.from({ length: days }, (_, i) => ymd(addDays(from, i))));
  return mergeGames(lists).filter((g) => wanted.has(localDateOf(g.date)));
}

/** Throws a user-facing error for unknown team input. */
function unknownTeam(cfg: LeagueConfig, input: string): never {
  const example = EXAMPLE_TEAM[cfg.sport] ?? "<abbr>";
  throw new Error(`Unknown ${cfg.label} team "${input}". Use an ESPN abbreviation (e.g. ${example}) or a team name.`);
}

type Scope =
  | { kind: "league" }
  | { kind: "teams"; ids: Set<string>; label: string }
  | { kind: "no-favorites" };

/**
 * Which teams a command is about: `--team X` (one resolved team), `--mine`
 * (the league's favorites, unresolvable ones warned about and skipped), or the
 * whole league. `--team` wins over `--mine`.
 */
async function scopeOf(cfg: LeagueConfig, args: string[]): Promise<Scope> {
  const teamArg = getFlag(args, "--team");
  const favs = teamArg ? null : await mineFavorites(args, cfg.sport);
  if (!teamArg && favs === null) return { kind: "league" };
  if (favs === "no-favorites") return { kind: "no-favorites" };

  const teams = await getTeams(cfg.league);
  if (teamArg) {
    const t = resolveTeam(teams, teamArg, cfg.aliases) ?? unknownTeam(cfg, teamArg);
    return { kind: "teams", ids: new Set([t.id]), label: t.name };
  }
  return { kind: "teams", ids: favoriteIds(cfg, teams, favs!), label: "your favorites" };
}

/** Resolve favorite names to team ids; unresolvable ones are warned about and skipped. */
function favoriteIds(cfg: LeagueConfig, teams: EspnTeam[], favs: string[]): Set<string> {
  const ids = new Set<string>();
  for (const f of favs) {
    const t = resolveTeam(teams, f, cfg.aliases);
    if (t) ids.add(t.id);
    else console.error(c.yellow(`Skipping favorite "${f}" — not a ${cfg.label} team.`));
  }
  return ids;
}

/** Every game for the scoped teams' full seasons. */
async function scopedSeasons(cfg: LeagueConfig, ids: Set<string>): Promise<Game[]> {
  return mergeGames(await Promise.all([...ids].map((id) => teamSeason(cfg, id))));
}

// ── Output ───────────────────────────────────────────────────────────────────

function title(cfg: LeagueConfig, text: string): void {
  console.log(c.bold(c.cyan(`${cfg.icon} ${cfg.label} — ${text}`)));
}

/** Print games under local-day headers, in the given order. */
function printByDay(games: Game[]): void {
  let currentDay = "";
  for (const g of games) {
    const day = localDateOf(g.date);
    if (day !== currentDay) {
      currentDay = day;
      console.log("\n" + c.bold(fmtDayHeader(g.date)));
    }
    console.log("  " + gameLine(g));
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

function parseOffset(args: string[]): number {
  if (args.includes("--tomorrow")) return 1;
  if (args.includes("--yesterday")) return -1;
  const v = getFlag(args, "--offset");
  return v ? parseInt(v, 10) || 0 : 0;
}

/** `today [--tomorrow|--yesterday|--offset N] [--mine]` — one local day's games. */
async function today(cfg: LeagueConfig, args: string[]): Promise<void> {
  const offset = parseOffset(args);
  const day = addDays(new Date(), offset);
  const scope = await scopeOf(cfg, args);
  if (scope.kind === "no-favorites") return noFavoritesHint(cfg.sport);

  let games = await gamesOnDays(cfg, day, 1);
  if (scope.kind === "teams") games = games.filter((g) => gameHasTeam(g, scope.ids));

  const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : ymd(day);
  title(cfg, `${label} (${ymd(day)})`);
  if (games.length === 0) {
    console.log(c.dim("\nNo games scheduled."));
    return;
  }
  console.log();
  for (const g of games) console.log("  " + gameLine(g));
}

/** `next [--team X] [--mine]` — the next game to start, with a countdown. */
async function next(cfg: LeagueConfig, args: string[]): Promise<void> {
  const scope = await scopeOf(cfg, args);
  if (scope.kind === "no-favorites") return noFavoritesHint(cfg.sport);

  const now = Date.now();
  let g: Game | null = null;
  if (scope.kind === "teams") {
    g = firstUpcoming(await scopedSeasons(cfg, scope.ids), now);
  } else {
    // League-wide: walk forward a day at a time until a game turns up.
    for (let i = 0; i < NEXT_SCAN_DAYS && !g; i++) {
      g = firstUpcoming(await gamesOnDays(cfg, addDays(new Date(), i), 1), now);
    }
  }

  if (!g) {
    const within = scope.kind === "league" ? ` in the next ${NEXT_SCAN_DAYS} days` : "";
    console.log(c.dim(`No upcoming ${cfg.label} games${scope.kind === "teams" ? ` for ${scope.label}` : ""}${within}.`));
    return;
  }
  title(cfg, "Next Game");
  console.log("\n  " + gameLine(g));
  console.log(c.dim("  " + g.name));
  console.log(`  ${c.bold(fmtDate(g.date))}  ${c.green("— starts " + relativeTime(g.date))}`);
}

/** `schedule [--team X | --mine]` — a team's (or your favorites') whole season,
 *  preseason through postseason; league-wide, the next week. */
async function schedule(cfg: LeagueConfig, args: string[]): Promise<void> {
  const scope = await scopeOf(cfg, args);
  if (scope.kind === "no-favorites") return noFavoritesHint(cfg.sport);

  const games =
    scope.kind === "teams" ? await scopedSeasons(cfg, scope.ids) : await gamesOnDays(cfg, new Date(), WINDOW_DAYS);
  const what = scope.kind === "teams" ? scope.label : `next ${WINDOW_DAYS} days`;
  title(cfg, `Schedule — ${what} (${games.length})`);
  if (games.length === 0) {
    console.log(c.dim("\nNo games to show."));
    return;
  }
  printByDay(games);
}

/** `results [--team X | --mine]` — finished games, newest first; league-wide,
 *  the past week. */
async function results(cfg: LeagueConfig, args: string[]): Promise<void> {
  const scope = await scopeOf(cfg, args);
  if (scope.kind === "no-favorites") return noFavoritesHint(cfg.sport);

  const pool =
    scope.kind === "teams"
      ? await scopedSeasons(cfg, scope.ids)
      : await gamesOnDays(cfg, addDays(new Date(), -(WINDOW_DAYS - 1)), WINDOW_DAYS);
  const games = finishedNewestFirst(pool);
  const what = scope.kind === "teams" ? scope.label : `last ${WINDOW_DAYS} days`;
  title(cfg, `Results — ${what} (${games.length})`);
  if (games.length === 0) {
    console.log(c.dim("\nNo finished games yet."));
    return;
  }
  printByDay(games);
}

/** `standings [--conference X | --division X]` — regular-season standings,
 *  favorites highlighted. Tables are the league's default level (NBA
 *  conferences, NHL divisions); a filter switches to that level and shows the
 *  one matching table. Before the regular season, last season's final
 *  standings, labelled as such. */
async function standings(cfg: LeagueConfig, args: string[]): Promise<void> {
  const layout = STANDINGS_LAYOUTS[cfg.league];
  if (!layout) throw new Error(`No standings layout for ${cfg.label}.`);
  const conference = getFlag(args, "--conference");
  const division = getFlag(args, "--division");
  if (conference && division) throw new Error("Use --conference or --division, not both.");
  const filter = conference ?? division;
  const level: StandingsLevel = conference ? "conference" : division ? "division" : layout.level;

  const [view, favs] = await Promise.all([
    loadStandingsView((q) => getStandings(cfg.league, q), level),
    getFavorites(cfg.sport),
  ]);
  if (view.kind === "not-started") {
    title(cfg, `Standings${view.upcoming ? ` ${view.upcoming}` : ""}`);
    console.log(c.dim("\nThe regular season hasn't started yet, and ESPN has no earlier standings to show."));
    return;
  }

  const { standings: data } = view;
  const groups = filter ? data.groups.filter((g) => groupMatches(g, filter)) : data.groups;
  if (groups.length === 0) {
    const names = data.groups.map((g) => g.abbreviation || g.name).join(", ");
    throw new Error(`No ${cfg.label} ${level} "${filter}". Try one of: ${names}.`);
  }
  const ids = favs.length > 0 ? favoriteIds(cfg, await getTeams(cfg.league), favs) : new Set<string>();

  title(cfg, `Standings ${data.seasonName}${view.kind === "last-season" ? " (final)" : ""}`);
  if (view.kind === "last-season") {
    const upcoming = view.upcoming ? `The ${view.upcoming} regular season` : "The regular season";
    console.log(c.yellow(`${upcoming} hasn't started — showing last season's final standings.`));
  }
  for (const g of groups) console.log("\n" + renderStandingsTable(g, layout, ids));
}

/** `season [team]` — each favorite's (or the named team's) season at a glance:
 *  record, splits, conference/division position, playoff race. Before the
 *  regular season, last season's final standing, labelled as such. */
async function season(cfg: LeagueConfig, args: string[]): Promise<void> {
  const layout = STANDINGS_LAYOUTS[cfg.league];
  const format = PLAYOFF_FORMATS[cfg.league];
  if (!layout || !format) throw new Error(`No season view for ${cfg.label}.`);
  const input = args.join(" ").trim();
  const teams = await getTeams(cfg.league);
  let ids: Set<string>;
  if (input) {
    ids = new Set([(resolveTeam(teams, input, cfg.aliases) ?? unknownTeam(cfg, input)).id]);
  } else {
    const favs = await getFavorites(cfg.sport);
    if (favs.length === 0) return noFavoritesHint(cfg.sport);
    ids = favoriteIds(cfg, teams, favs);
  }

  const view = await loadStandingsView((q) => getStandings(cfg.league, q), "division");
  if (view.kind === "not-started") {
    title(cfg, `Season${view.upcoming ? ` ${view.upcoming}` : ""}`);
    console.log(c.dim("\nThe regular season hasn't started yet, and ESPN has no earlier standings to show."));
    return;
  }
  const { standings: data } = view;
  title(cfg, `Season ${data.seasonName}${view.kind === "last-season" ? " (final)" : ""}`);
  if (view.kind === "last-season") {
    const upcoming = view.upcoming ? `The ${view.upcoming} regular season` : "The regular season";
    console.log(c.yellow(`${upcoming} hasn't started — showing last season's final standing.`));
  }
  for (const id of ids) {
    const summary = summarizeSeason(data.groups, id, layout, format);
    const name = teams.find((t) => t.id === id)?.name ?? id;
    console.log("\n" + (summary ? renderSeasonSummary(summary) : c.dim(`${name}: not in the ${data.seasonName} standings.`)));
  }
}

/** `fav [add|rm|list] [team]` — `add` resolves the team against the league's
 *  /teams list and stores its ESPN abbreviation; list/rm are the shared fav. */
async function leagueFav(cfg: LeagueConfig, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const input = rest.join(" ").trim();
  if (sub === "add" && input) {
    const t = resolveTeam(await getTeams(cfg.league), input, cfg.aliases) ?? unknownTeam(cfg, input);
    return fav(["add", t.abbreviation], cfg.sport);
  }
  return fav(args, cfg.sport);
}

const COMMANDS: Record<string, (cfg: LeagueConfig, args: string[]) => Promise<void>> = {
  today,
  next,
  schedule,
  results,
  standings,
  season,
  fav: leagueFav,
};

const ALIASES: Record<string, string> = { t: "today", n: "next", st: "standings" };

function help(cfg: LeagueConfig): void {
  const b = c.bold;
  const s = cfg.sport;
  const ex = EXAMPLE_TEAM[s] ?? "<team>";
  console.log(`${b(c.cyan(`${cfg.icon} sportsing ${s}`))} — ${cfg.label}, preseason through playoffs

${b("USAGE")}
  sportsing ${s} <command> [options]

${b("COMMANDS")}
  ${c.green("today")}              Games today  ${c.dim("(--tomorrow, --yesterday, --offset N)")}
  ${c.green("next")}               Next game + countdown
  ${c.green("schedule")}           A team's whole season, by day ${c.dim(`(league-wide: next ${WINDOW_DAYS} days)`)}
  ${c.green("results")}            Finished games, newest first ${c.dim(`(league-wide: last ${WINDOW_DAYS} days)`)}
  ${c.green("standings")}          Regular-season standings, favorites ★ ${c.dim("(--conference X, --division X)")}
  ${c.green("season")} ${c.dim("[team]")}      Favorites' season: record, splits, playoff race
  ${c.green("fav")}    ${c.dim("[add|rm|list]")} Manage favorite teams

${b("FILTER")}
  ${c.dim("--team X")} on today/next/schedule/results picks one team (abbreviation or name).
  ${c.dim("--mine")} on today/next/schedule/results limits output to your ${cfg.label} favorites.
  ${c.dim("--conference X")} / ${c.dim("--division X")} on standings shows one table (e.g. West, Pacific).

${b("TAGS")}
  ${c.yellow("PRE")} preseason · ${c.magenta("POST")} postseason. Times are local.

${b("DATA")}
  ESPN's free (unofficial) API — no key needed.

${b("EXAMPLES")}
  sportsing ${s} today
  sportsing ${s} fav add ${ex}
  sportsing ${s} schedule --team ${ex}
  sportsing ${s} results --mine
  sportsing ${s} standings --conference West
`);
}

/** Build a `sportsing <sport> <command>` dispatcher for a league. */
export function leagueNamespace(cfg: LeagueConfig): (args: string[]) => Promise<void> {
  return async (args) => {
    const [cmd, ...rest] = args;
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return help(cfg);
    const run = COMMANDS[cmd] ?? COMMANDS[ALIASES[cmd] ?? ""];
    if (!run) {
      console.error(c.red(`Unknown ${cfg.sport} command: ${cmd}`));
      console.error(c.dim(`Run \`sportsing ${cfg.sport} help\` for usage.`));
      process.exitCode = 1;
      return;
    }
    await run(cfg, rest);
  };
}
