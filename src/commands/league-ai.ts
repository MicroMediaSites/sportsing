// `sportsing <nba|nhl> analyze|predict|recap <team> [team] [--prompt]` — the
// AI commands for the ESPN-backed leagues. Same model as the World Cup versions
// (src/commands/analyze.ts, predict.ts, recap.ts): sportsing fetches + fences the
// data and posts the prompt to the ask bus for an EXTERNAL Claude agent (a
// `/loop sportsing fifa serve` session) — it never runs a model itself. --prompt
// prints the assembled prompt instead of posting it.
//
// The prompts and the stats they carry are per-sport (src/league-ai.ts). Teams
// and games come in through `LeagueGames` (built by league.ts), so every lookup
// is by ESPN team id within one league.

import { c } from "../ansi.ts";
import { postQuestion, waitForAnswer, isServing, type AskSource } from "../ask-bus.ts";
import type { EspnGameSummary, EspnTeam } from "../espn.ts";
import type { Game } from "../game.ts";
import { buildAnalyzePrompt, buildPredictPrompt, catchupInput, sportAiFor, teamForm, type SportAi } from "../league-ai.ts";
import { buildRecapPrompt, hasNotableEvents, requestRecap } from "../recap.ts";
import type { LeagueConfig } from "./league.ts";

/** One league's data, as the AI commands need it. */
export interface LeagueGames {
  /** Resolve user input to a team in this league, or null. */
  team(input: string): Promise<EspnTeam | null>;
  /** Every game in one team's season (preseason through postseason), ascending. */
  season(teamId: string): Promise<Game[]>;
  /** Box score + play-by-play for one game, or null if ESPN has none. */
  summary(gameId: string): Promise<EspnGameSummary | null>;
}

const ANSWER_TIMEOUT_MS = 180_000;

// ── Pure selection (unit-tested) ─────────────────────────────────────────────

/** The game to analyze or recap: a live one if any, else the most recent finished one. */
export function pickPlayed(games: Game[]): Game | null {
  const live = games.find((g) => g.state === "in");
  if (live) return live;
  return games.filter((g) => g.state === "post").sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0] ?? null;
}

/** The game to predict: the soonest one that hasn't started (never a finished one). */
export function pickUpcoming(games: Game[], now: number): Game | null {
  return (
    games
      .filter((g) => g.state === "pre" && Date.parse(g.date) >= now)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null
  );
}

/** Only the games involving `teamId` (both sides checked; ids are league-scoped). */
export function withTeam(games: Game[], teamId: string): Game[] {
  return games.filter((g) => g.home.id === teamId || g.away.id === teamId);
}

// ── Shared plumbing ──────────────────────────────────────────────────────────

/**
 * Positional terms → one or two teams. The whole phrase is tried first (so
 * "Utah Jazz" is one team), then each term on its own ("jazz nuggets").
 * Throws a user-facing error for anything unresolvable.
 */
export async function resolveTerms(cfg: LeagueConfig, games: LeagueGames, terms: string[]): Promise<EspnTeam[]> {
  const whole = await games.team(terms.join(" "));
  if (whole) return [whole];
  if (terms.length > 2) throw new Error(`Couldn't resolve "${terms.join(" ")}" to one or two ${cfg.label} teams.`);
  const out: EspnTeam[] = [];
  for (const t of terms) {
    const team = await games.team(t);
    if (!team) throw new Error(`Unknown ${cfg.label} team "${t}". Use an ESPN abbreviation or a team name.`);
    out.push(team);
  }
  return out;
}

interface Setup {
  ai: SportAi;
  promptOnly: boolean;
  teams: EspnTeam[];
}

/** Parse args and resolve teams; null (with a usage error printed) if there's nothing to do. */
async function setup(cfg: LeagueConfig, games: LeagueGames, cmd: string, args: string[]): Promise<Setup | null> {
  const ai = sportAiFor(cfg.league);
  if (!ai) throw new Error(`${cmd} isn't available for ${cfg.label}.`);
  const terms = args.filter((a) => !a.startsWith("--"));
  if (terms.length === 0) {
    console.error(c.red(`Usage: sportsing ${cfg.sport} ${cmd} <team> [team] [--prompt]`));
    process.exitCode = 1;
    return null;
  }
  return { ai, promptOnly: args.includes("--prompt"), teams: await resolveTerms(cfg, games, terms) };
}

/** The first team's season, narrowed to games against the second team if given. */
async function candidateGames(games: LeagueGames, teams: EspnTeam[]): Promise<Game[]> {
  const season = await games.season(teams[0]!.id);
  return teams[1] ? withTeam(season, teams[1].id) : season;
}

const who = (teams: EspnTeam[]) => teams.map((t) => t.name).join(" vs ");

/** Post a prompt to the ask bus and print the answer (or the no-agent hint). */
async function ask(source: AskSource, prompt: string, context: string, hint: string, heading: string): Promise<void> {
  process.stderr.write(c.dim("Posted to the ask bus — waiting for your Claude agent to answer…\n"));
  process.stderr.write(c.dim("(keep one serving:  /loop sportsing fifa serve)\n"));
  const id = await postQuestion({ source, question: prompt, context, hint, maxChars: null });
  const answer = await waitForAnswer(id, ANSWER_TIMEOUT_MS);
  if (answer === null) {
    console.error(c.yellow("No Claude agent answered within 3 minutes."));
    console.error(c.dim("Start a serving agent in another Claude session, then retry:  /loop sportsing fifa serve"));
    console.error(c.dim("Or run with --prompt to get the prompt and use it elsewhere."));
    process.exitCode = 1;
    return;
  }
  console.log(heading + "\n");
  console.log(answer);
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** `analyze <team> [team] [--prompt]` — a read of the live or latest finished game. */
export async function leagueAnalyze(cfg: LeagueConfig, games: LeagueGames, args: string[]): Promise<void> {
  const s = await setup(cfg, games, "analyze", args);
  if (!s) return;
  const g = pickPlayed(await candidateGames(games, s.teams));
  if (!g) {
    console.log(c.dim(`No played ${cfg.label} game found for ${who(s.teams)}. Analysis needs a game that has started.`));
    return;
  }
  const summary = await games.summary(g.id);
  if (!summary || summary.home.stats.length === 0) {
    console.log(c.dim(`No box score for ${g.name} yet — nothing to analyze.`));
    return;
  }
  const prompt = buildAnalyzePrompt(s.ai, g, summary);
  if (s.promptOnly) return void console.log(prompt);
  await ask(
    "analyze",
    prompt,
    g.name,
    "Follow the format requested in the prompt (a 4–6 sentence read, plain prose).",
    c.bold(c.cyan(`${cfg.icon} ${g.name} — analysis`)) + "  " + c.dim(summary.detail),
  );
}

/** `predict <team> [team] [--prompt]` — the next game's likely outcome from both teams' form. */
export async function leaguePredict(cfg: LeagueConfig, games: LeagueGames, args: string[]): Promise<void> {
  const s = await setup(cfg, games, "predict", args);
  if (!s) return;
  const first = await games.season(s.teams[0]!.id);
  const pool = s.teams[1] ? withTeam(first, s.teams[1].id) : first;
  const g = pickUpcoming(pool, Date.now());
  if (!g) {
    console.log(c.dim(`No upcoming ${cfg.label} game found for ${who(s.teams)}.`));
    return;
  }
  // Each side's form comes from its own season (the first team's is already in hand).
  const seasonOf = (id: string) => (id === s.teams[0]!.id ? Promise.resolve(first) : games.season(id));
  const [homeSeason, awaySeason] = await Promise.all([seasonOf(g.home.id), seasonOf(g.away.id)]);
  const prompt = buildPredictPrompt(s.ai, g, teamForm(homeSeason, g.home.id), teamForm(awaySeason, g.away.id));
  if (s.promptOnly) return void console.log(prompt);
  await ask(
    "predict",
    prompt,
    g.name,
    "Follow the format requested in the prompt (scoreline, win probabilities, 2–3 sentences).",
    c.bold(c.cyan(`${cfg.icon} ${g.name} — prediction`)),
  );
}

/** `recap <team> [team] [--prompt]` — "here's what you missed" for the live or latest game. */
export async function leagueRecap(cfg: LeagueConfig, games: LeagueGames, args: string[]): Promise<void> {
  const s = await setup(cfg, games, "recap", args);
  if (!s) return;
  const g = pickPlayed(await candidateGames(games, s.teams));
  if (!g) {
    console.log(c.dim(`No ${cfg.label} game in progress or played for ${who(s.teams)} — nothing to recap.`));
    return;
  }
  const summary = await games.summary(g.id);
  if (!summary) {
    console.log(c.dim(`No play-by-play for ${g.name} yet — nothing to recap.`));
    return;
  }
  const input = catchupInput(s.ai, g, summary);
  if (s.promptOnly) return void console.log(buildRecapPrompt(input));

  if (hasNotableEvents(input.events) && (await isServing())) {
    process.stderr.write(c.dim("Posted to the ask bus — waiting for your Claude agent to answer…\n"));
  }
  const res = await requestRecap(input);
  if (res.ok) {
    console.log(c.bold(c.cyan(`${cfg.icon} ${input.fixture} — catch up`)) + "  " + c.dim(`${input.scoreline} · ${input.detail}`) + "\n");
    console.log(res.recap);
    return;
  }
  if (res.reason === "empty") return void console.log(c.dim(res.message));
  console.error(c.yellow(res.message));
  console.error(c.dim("Or run with --prompt to get the prompt and recap elsewhere."));
  process.exitCode = 1;
}
