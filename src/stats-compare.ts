// `stats A B` (two teams side by side) and `stats --ahead [team]` (fixture
// difficulty), built on the shared stats engine (src/stats.ts). The pure parts
// — which side is better, meetings, opponent positions and averages, sorting,
// rendering — are separate from the fetching, so they are unit-tested without
// network. The command layer (src/commands/league.ts) only dispatches to
// compareCommand / aheadCommand.
//
// "Table position" is the team's place in the whole league, 1 = top: soccer's
// own table; NBA/NHL ordered across conferences by the same stat `standings`
// ranks by (win %, points). Before the regular season has a game the shown
// table is last season's final one, and the output says so.

import { c, pad } from "./ansi.ts";
import { getFavorites } from "./config.ts";
import { getClubTeamGames, getStandings, getTeamGames, getTeams, isClubSoccer, SEASON_TYPES, type EspnStandings, type EspnStandingsEntry, type EspnTeam } from "./espn.ts";
import { fmtDate } from "./format.ts";
import type { Game } from "./game.ts";
import { STANDINGS_LAYOUTS, loadStandingsView, sortEntries, type StandingsView } from "./standings.ts";
import { formatStat, loadLeagueStats, mapLimit, CONCURRENCY, type LeagueStats, type StatDef, type StatFormat, type StatProfile, type TeamResult, type TeamStatLine } from "./stats.ts";
import { EXAMPLE_TEAM } from "./commands/_lib.ts";
import { favoriteIds, resolveTeam, type LeagueConfig } from "./commands/league.ts";

/** Upcoming league games listed per team by `--ahead`. */
export const AHEAD_GAMES = 5;

// ── Table positions ──────────────────────────────────────────────────────────

export interface TablePlace {
  /** 1 = top of the whole league. */
  position: number;
  /** "12-3" (NBA), "3-1-1" (soccer W-D-L), "4-2-1" (NHL W-L-OTL). */
  record: string;
  /** Points, where the table ranks by them (soccer, NHL; not NBA). */
  points: number | null;
}

const n = (v: string | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** A team's record as the league writes it. */
export function recordOf(stats: Record<string, string>, form: StatProfile["form"]): string {
  const w = n(stats.wins);
  const l = n(stats.losses);
  if (form === "wdl") return `${w}-${n(stats.ties)}-${l}`;
  if (form === "wl-otl") return `${w}-${l}-${n(stats.otLosses)}`;
  return `${w}-${l}`;
}

/** Every team's league-wide place, by ESPN team id. Tables are merged and
 *  ordered by `rankBy` (descending, or ascending when it is a position). */
export function tablePlaces(
  standings: EspnStandings,
  form: StatProfile["form"],
  order: { rankBy: string; rankIsPosition?: boolean },
): Map<string, TablePlace> {
  const entries: EspnStandingsEntry[] = standings.groups.flatMap((g) => g.entries);
  const out = new Map<string, TablePlace>();
  sortEntries(entries, order.rankBy, order.rankIsPosition).forEach((e, i) => {
    out.set(e.teamId, {
      position: i + 1,
      record: recordOf(e.stats, form),
      points: form === "wl" || e.stats.points === undefined ? null : n(e.stats.points),
    });
  });
  return out;
}

/** The standings view → places; empty when ESPN has no table at all. */
export function placesOf(cfg: LeagueConfig, view: StandingsView): Map<string, TablePlace> {
  const layout = STANDINGS_LAYOUTS[cfg.league];
  if (view.kind === "not-started" || !layout) return new Map();
  return tablePlaces(view.standings, cfg.statProfile.form, layout);
}

// ── Compare (pure) ───────────────────────────────────────────────────────────

export type Side = "a" | "b" | "tie";

/** Which side of a stat is better, honoring `higherIsBetter`; null when either
 *  value is missing, "tie" when they are equal. */
export function betterSide(def: Pick<StatDef, "higherIsBetter">, a: number | null, b: number | null): Side | null {
  if (a === null || b === null) return null;
  if (Math.abs(a - b) < 1e-9) return "tie";
  return (a > b) === def.higherIsBetter ? "a" : "b";
}

/** `a`'s finished games against team `bId`, oldest first (a's point of view). */
export function meetings(a: Pick<TeamStatLine, "results">, bId: string): TeamResult[] {
  return a.results.filter((r) => r.opponentId === bId);
}

export interface CompareRow {
  key: string;
  label: string;
  short: string;
  higherIsBetter: boolean;
  format: StatFormat;
  a: { value: number | null; rank: number | null };
  b: { value: number | null; rank: number | null };
  better: Side | null;
}

export interface CompareTeam {
  id: string;
  abbreviation: string;
  name: string;
  favorite: boolean;
  played: number;
  record: string | null;
  position: number | null;
  points: number | null;
  /** The last results, oldest first. */
  form: string[];
}

export interface Meeting {
  date: string;
  /** Which team hosted: "a" or "b". */
  home: "a" | "b";
  /** Score as "a-b" regardless of who hosted. */
  a: number;
  b: number;
  winner: Side;
}

export interface Comparison {
  league: string;
  sport: string;
  /** "current" or "last-season" — whose figures and table these are. */
  kind: LeagueStats["kind"];
  season: string;
  teams: { a: CompareTeam; b: CompareTeam };
  stats: CompareRow[];
  meetings: Meeting[];
}

function compareTeam(line: TeamStatLine, place: TablePlace | undefined, favorite: boolean): CompareTeam {
  return {
    id: line.teamId,
    abbreviation: line.abbreviation,
    name: line.name,
    favorite,
    played: line.played,
    record: place?.record ?? null,
    position: place?.position ?? null,
    points: place?.points ?? null,
    form: line.form.map((r) => r.outcome),
  };
}

/** The comparison of two teams: every profile stat with both ranks and the
 *  better side, header facts, and the meetings between them. */
export function buildComparison(
  stats: LeagueStats,
  a: TeamStatLine,
  b: TeamStatLine,
  places: Map<string, TablePlace>,
  favorites: ReadonlySet<string> = new Set(),
): Comparison {
  const rows = stats.profile.stats.map((def): CompareRow => {
    const av = a.values[def.key] ?? null;
    const bv = b.values[def.key] ?? null;
    return {
      key: def.key,
      label: def.label,
      short: def.short,
      higherIsBetter: def.higherIsBetter,
      format: def.format,
      a: { value: av, rank: a.ranks[def.key] ?? null },
      b: { value: bv, rank: b.ranks[def.key] ?? null },
      better: betterSide(def, av, bv),
    };
  });
  const met: Meeting[] = meetings(a, b.teamId).map((r) => ({
    date: r.date,
    home: r.home ? "a" : "b",
    a: r.scored,
    b: r.conceded,
    winner: r.scored === r.conceded ? "tie" : r.scored > r.conceded ? "a" : "b",
  }));
  return {
    league: stats.label,
    sport: stats.sport,
    kind: stats.kind,
    season: stats.seasonName,
    teams: {
      a: compareTeam(a, places.get(a.teamId), favorites.has(a.teamId)),
      b: compareTeam(b, places.get(b.teamId), favorites.has(b.teamId)),
    },
    stats: rows,
    meetings: met,
  };
}

// ── Compare (render) ─────────────────────────────────────────────────────────

const formLetter = (o: string): string => (o === "W" ? c.green(o) : o === "L" ? c.red(o) : c.yellow(o));

function headerLine(t: CompareTeam): string {
  const name = t.favorite ? c.bold(c.yellow(`★ ${t.name}`)) : c.bold(t.name);
  const bits = [
    t.record ? `${t.record}${t.points !== null ? `, ${t.points} pts` : ""}` : null,
    t.position !== null ? `#${t.position} in the table` : null,
    t.played > 0 ? `${t.played} played` : null,
  ].filter((x): x is string => x !== null);
  const form = t.form.length ? `  form ${t.form.map(formLetter).join(" ")}` : "";
  return `${name}  ${c.dim(bits.join(" · "))}${form}`;
}

const LABEL_W = 26;

/** One side of a stat row: value, league rank, and a check on the better side. */
function statCell(row: CompareRow, side: "a" | "b"): string {
  const { value, rank } = row[side];
  const v = pad(formatStat(row, value), 8, "right");
  const r = pad(rank === null ? "" : `#${rank}`, 4, "right");
  return row.better === side ? c.bold(c.green(v)) + " " + c.green(r) + c.green(" ✓") : v + " " + c.dim(r) + "  ";
}

/** The comparison as terminal text (no trailing newline). */
export function renderComparison(cmp: Comparison): string {
  const { a, b } = cmp.teams;
  const lines = [headerLine(a), headerLine(b)];
  if (cmp.kind === "last-season") lines.push(c.yellow(`Preseason — figures and table are ${cmp.season}'s.`));
  lines.push("");
  // Each cell is value(8) + " " + rank(4) + mark(2); team codes sit over the values.
  lines.push(c.dim(pad("", LABEL_W) + pad(a.abbreviation, 8, "right") + pad("", 7) + " " + pad(b.abbreviation, 8, "right")));
  for (const row of cmp.stats) {
    lines.push(pad(row.label, LABEL_W) + statCell(row, "a") + " " + statCell(row, "b"));
  }
  return [...lines, "", ...renderMeetings(cmp)].join("\n");
}

function renderMeetings(cmp: Comparison): string[] {
  const { a, b } = cmp.teams;
  if (cmp.meetings.length === 0) return [c.dim(`${a.abbreviation} and ${b.abbreviation} haven't met this season.`)];
  const lines = [c.bold(`Meetings this season (${cmp.season})`)];
  for (const m of cmp.meetings) {
    const homeTeam = m.home === "a" ? a : b;
    const awayTeam = m.home === "a" ? b : a;
    const hs = m.home === "a" ? m.a : m.b;
    const as = m.home === "a" ? m.b : m.a;
    const result = m.winner === "tie" ? "draw" : `${(m.winner === "a" ? a : b).abbreviation} won`;
    lines.push(`  ${pad(fmtDate(m.date), 24)} ${homeTeam.abbreviation} ${hs}-${as} ${awayTeam.abbreviation}  ${c.dim(`(${homeTeam.abbreviation} home, ${result})`)}`);
  }
  return lines;
}

// ── Ahead (pure) ─────────────────────────────────────────────────────────────

export interface AheadOpponent {
  id: string;
  abbreviation: string;
  name: string;
  date: string;
  /** True if the team under review hosts this game. */
  home: boolean;
  /** The opponent's current table position; null if it isn't in the table. */
  position: number | null;
}

export interface AheadRow {
  team: { id: string; abbreviation: string; name: string; favorite: boolean; position: number | null };
  next: AheadOpponent[];
  /** Mean of the opponents' positions (lower = a harder run); null if none known. */
  avgOpponentPosition: number | null;
}

/** `teamId`'s next `count` not-yet-started games, soonest first, as opponents
 *  (a game with an unknown opponent id is skipped). */
export function upcomingOpponents(
  games: Game[],
  teamId: string,
  places: Map<string, TablePlace>,
  count = AHEAD_GAMES,
): AheadOpponent[] {
  const seen = new Set<string>();
  return games
    .filter((g) => g.state === "pre" && (g.home.id === teamId || g.away.id === teamId))
    .sort((x, y) => Date.parse(x.date) - Date.parse(y.date))
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    .map((g): AheadOpponent => {
      const home = g.home.id === teamId;
      const opp = home ? g.away : g.home;
      return { id: opp.id, abbreviation: opp.abbreviation, name: opp.name, date: g.date, home, position: places.get(opp.id)?.position ?? null };
    })
    .filter((o) => o.id !== "")
    .slice(0, count);
}

/** Mean of the known positions to one decimal's precision kept as a number;
 *  null when there are none. */
export function averagePosition(positions: (number | null)[]): number | null {
  const known = positions.filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return Math.round((known.reduce((s, p) => s + p, 0) / known.length) * 10) / 10;
}

/** Hardest run first (lowest average opponent position); teams with no known
 *  average last; ties by team name. */
export function sortHardestFirst(rows: AheadRow[]): AheadRow[] {
  return [...rows].sort((x, y) => {
    const ax = x.avgOpponentPosition ?? Infinity;
    const ay = y.avgOpponentPosition ?? Infinity;
    return ax - ay || x.team.name.localeCompare(y.team.name);
  });
}

export function buildAheadRow(
  team: Pick<EspnTeam, "id" | "abbreviation" | "name">,
  games: Game[],
  places: Map<string, TablePlace>,
  favorite: boolean,
  count = AHEAD_GAMES,
): AheadRow {
  const next = upcomingOpponents(games, team.id, places, count);
  return {
    team: { id: team.id, abbreviation: team.abbreviation, name: team.name, favorite, position: places.get(team.id)?.position ?? null },
    next,
    avgOpponentPosition: averagePosition(next.map((o) => o.position)),
  };
}

// ── Ahead (render) ───────────────────────────────────────────────────────────

export interface AheadReport {
  league: string;
  sport: string;
  kind: "current" | "last-season";
  /** The season whose table the positions come from. */
  tableSeason: string;
  /** Hardest run first (a single team: just that one). */
  teams: AheadRow[];
}

const avgText = (v: number | null): string => (v === null ? "—" : v.toFixed(1));
const opponentText = (o: AheadOpponent): string => `${o.home ? "" : "@"}${o.abbreviation} ${o.position ?? "—"}`;

function renderTableNote(r: AheadReport): string {
  const base = "Opponent positions are the league table position (1 = top); a lower average means a harder run.";
  return r.kind === "last-season"
    ? c.dim(base) + "\n" + c.yellow(`The season hasn't started — positions come from ${r.tableSeason}'s final table.`)
    : c.dim(base);
}

/** The ahead report as terminal text. One team: its games in detail. Several:
 *  one line per team, hardest run first. */
export function renderAhead(r: AheadReport, detail: boolean): string {
  if (r.teams.length === 0) return c.dim("No upcoming games found.");
  if (detail) {
    const row = r.teams[0]!;
    const name = row.team.favorite ? c.bold(c.yellow(`★ ${row.team.name}`)) : c.bold(row.team.name);
    const lines = [`${name}${row.team.position !== null ? c.dim(`  #${row.team.position} in the table`) : ""}`];
    if (row.next.length === 0) lines.push(c.dim("  No upcoming league games found."));
    for (const o of row.next) {
      lines.push(`  ${pad(fmtDate(o.date), 24)} ${pad(o.home ? "vs" : "at", 3)}${pad(o.name, 26)} ${c.dim(o.position === null ? "—" : `#${o.position}`)}`);
    }
    lines.push(`  ${c.dim("Average opponent position")} ${c.bold(avgText(row.avgOpponentPosition))}`);
    return [...lines, "", renderTableNote(r)].join("\n");
  }
  const TEAM_W = 24;
  const header = c.dim(pad("#", 3) + pad("  Team", TEAM_W) + pad("Avg", 6, "right") + "  Next " + AHEAD_GAMES + " (@ = away, then opponent position)");
  const lines = r.teams.map((row, i) => {
    const name = row.team.favorite ? c.bold(c.yellow(`★ ${row.team.name}`)) : `  ${row.team.name}`;
    return pad(c.dim(String(i + 1)), 3) + pad(name, TEAM_W) + pad(avgText(row.avgOpponentPosition), 6, "right") + "  " + row.next.map(opponentText).join("  ");
  });
  return [header, ...lines, "", renderTableNote(r), c.dim("Hardest run first.")].join("\n");
}

// ── Commands ─────────────────────────────────────────────────────────────────

function unknownTeam(cfg: LeagueConfig, input: string): never {
  const example = EXAMPLE_TEAM[cfg.sport] ?? "<abbr>";
  throw new Error(`Unknown ${cfg.label} team "${input}". Use an ESPN abbreviation (e.g. ${example}) or a team name.`);
}

async function favoriteTeamIds(cfg: LeagueConfig, teams: EspnTeam[]): Promise<Set<string>> {
  return favoriteIds(cfg, teams, await getFavorites(cfg.sport));
}

/** `stats A B`: two teams side by side with league ranks, and their meetings. */
export async function compareCommand(cfg: LeagueConfig, a: string, b: string, opts: { json: boolean }): Promise<void> {
  const teams = await getTeams(cfg.league);
  const teamA = resolveTeam(teams, a, cfg.aliases) ?? unknownTeam(cfg, a);
  const teamB = resolveTeam(teams, b, cfg.aliases) ?? unknownTeam(cfg, b);
  if (teamA.id === teamB.id) throw new Error(`"${a}" and "${b}" are the same team — name two different ${cfg.label} teams.`);

  const [stats, view, favs] = await Promise.all([
    loadLeagueStats(cfg),
    loadStandingsView((q) => getStandings(cfg.league, q), "conference"),
    favoriteTeamIds(cfg, teams),
  ]);
  const lineA = stats.teams.find((t) => t.teamId === teamA.id);
  const lineB = stats.teams.find((t) => t.teamId === teamB.id);
  if (stats.kind === "not-started" || !lineA || !lineB) {
    if (opts.json) return console.log(JSON.stringify({ league: cfg.label, sport: cfg.sport, kind: "not-started", season: stats.upcoming }, null, 2));
    console.log(c.bold(c.cyan(`${cfg.icon} ${cfg.label} — ${teamA.name} vs ${teamB.name}`)));
    console.log(c.dim(`\n${stats.upcoming || "The season"} hasn't started, and ESPN has no earlier stats to show.`));
    return;
  }
  const cmp = buildComparison(stats, lineA, lineB, placesOf(cfg, view), favs);
  if (opts.json) return console.log(JSON.stringify(cmp, null, 2));
  console.log(c.bold(c.cyan(`${cfg.icon} ${cfg.label} — ${teamA.name} vs ${teamB.name}`)));
  console.log("\n" + renderComparison(cmp));
}

/** A team's upcoming league games: soccer's club fixtures, else the regular-season schedule. */
async function upcomingGames(cfg: LeagueConfig, teamId: string): Promise<Game[]> {
  if (isClubSoccer(cfg.league)) return getClubTeamGames(cfg.league, teamId);
  return getTeamGames(cfg.league, teamId, SEASON_TYPES.regular);
}

/** `stats --ahead [team]`: the next 5 league games with the opponents' table
 *  positions; league-wide, teams sorted hardest run first. */
export async function aheadCommand(cfg: LeagueConfig, team: string | null, opts: { json: boolean }): Promise<void> {
  const teams = await getTeams(cfg.league);
  const one = team === null ? null : resolveTeam(teams, team, cfg.aliases) ?? unknownTeam(cfg, team);
  const [view, favs] = await Promise.all([
    loadStandingsView((q) => getStandings(cfg.league, q), "conference"),
    favoriteTeamIds(cfg, teams),
  ]);
  const heading = c.bold(c.cyan(`${cfg.icon} ${cfg.label} — Fixture difficulty${one ? `: ${one.name}` : ""}`));
  if (view.kind === "not-started") {
    if (opts.json) return console.log(JSON.stringify({ league: cfg.label, sport: cfg.sport, kind: "not-started", season: view.upcoming }, null, 2));
    console.log(heading);
    console.log(c.dim(`\n${view.upcoming || "The season"} hasn't started, and ESPN has no earlier table to take positions from.`));
    return;
  }
  const places = placesOf(cfg, view);
  const scope = one ? [one] : teams;
  const games = await mapLimit(scope, CONCURRENCY, (t) => upcomingGames(cfg, t.id));
  const rows = scope.map((t, i) => buildAheadRow(t, games[i]!, places, favs.has(t.id)));
  const report: AheadReport = {
    league: cfg.label,
    sport: cfg.sport,
    kind: view.kind,
    tableSeason: view.standings.seasonName,
    teams: one ? rows : sortHardestFirst(rows),
  };
  if (opts.json) return console.log(JSON.stringify(report, null, 2));
  console.log(heading);
  console.log("\n" + renderAhead(report, one !== null));
}
