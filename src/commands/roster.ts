// `roster [team]` (alias `squad`) for every league and FIFA: resolve the team
// (argument, `--team`, else the league's favorites), load the squad
// (src/squad.ts), apply --pos / --by and print it (src/roster.ts).

import { c } from "../ansi.ts";
import { getFavorites } from "../config.ts";
import { getTeams, type EspnTeam } from "../espn.ts";
import { applyRosterView, parseRosterArgs, renderRoster, rosterJson, seasonLines, type RosterRequest } from "../roster.ts";
import { loadSquad, type Squad, type SquadLeague } from "../squad.ts";
import { EXAMPLE_TEAM } from "./_lib.ts";

/** league.ts's resolveTeam, passed in (importing it here would be a cycle). */
export type TeamResolver = (teams: EspnTeam[], input: string, aliases?: Record<string, string>) => EspnTeam | null;

/** A league for `roster`: the squad engine's view of it, plus what team input needs. */
export type RosterLeague = SquadLeague & { icon: string; aliases?: Record<string, string> };

/** Teams the command is about: the named one, else the league's favorites
 *  (unresolvable ones warned about and skipped). Throws a usage error when the
 *  team is unknown or there is nothing to go on. */
export function rosterTeams(cfg: RosterLeague, teams: EspnTeam[], team: string | null, favs: string[], resolveTeam: TeamResolver): EspnTeam[] {
  const example = EXAMPLE_TEAM[cfg.sport] ?? "<team>";
  if (team !== null) {
    const t = resolveTeam(teams, team, cfg.aliases);
    if (!t) throw new Error(`Unknown ${cfg.label} team "${team}". Use an ESPN abbreviation (e.g. ${example}) or a team name.`);
    return [t];
  }
  const found: EspnTeam[] = [];
  for (const f of favs) {
    const t = resolveTeam(teams, f, cfg.aliases);
    if (!t) console.error(c.yellow(`Skipping favorite "${f}" — not a ${cfg.label} team.`));
    else if (!found.some((x) => x.id === t.id)) found.push(t);
  }
  if (found.length === 0) {
    throw new Error(`No team given and no ${cfg.label} favorites. Name a team (sportsing ${cfg.sport} roster ${example}) or add a favorite (sportsing ${cfg.sport} fav add ${example}).`);
  }
  return found;
}

export async function roster(cfg: RosterLeague, args: string[], resolveTeam: TeamResolver): Promise<void> {
  let req: RosterRequest;
  let squads: Squad[];
  try {
    req = parseRosterArgs(args);
    const [teams, favs] = await Promise.all([getTeams(cfg.league), req.team === null ? getFavorites(cfg.sport) : Promise.resolve([])]);
    const picked = rosterTeams(cfg, teams, req.team, favs, resolveTeam);
    squads = await Promise.all(picked.map((t) => loadSquad(cfg, t, { stats: req.stats })));
  } catch (e) {
    console.error(c.red((e as Error).message));
    process.exitCode = 1;
    return;
  }

  // Validate --pos / --by on every squad before printing anything.
  let views;
  try {
    views = squads.map((s) => applyRosterView(s, req));
  } catch (e) {
    console.error(c.red((e as Error).message));
    process.exitCode = 1;
    return;
  }

  if (req.json) {
    const docs = views.map((v) => rosterJson(v, req));
    return console.log(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));
  }
  views.forEach((view, i) => {
    if (i > 0) console.log();
    const { squad, by } = view;
    const what = by ? `${squad.team.name} — players by ${by.label}` : `${squad.team.name} roster`;
    console.log(c.bold(c.cyan(`${cfg.icon} ${cfg.label} — ${what}`)));
    for (const line of seasonLines(squad.season, cfg.sport === "fifa")) console.log(line);
    console.log("\n" + renderRoster(view, { stats: req.stats }));
  });
}
