// `sportsing <league> teams` — the league's teams with the code `--team`
// accepts, the display name, and the configured aliases that map to it.
// Pure formatting; the command in commands/league.ts does the fetching.

import type { EspnTeam } from "./espn.ts";

export interface TeamRow {
  id: string;
  /** Exactly what `--team` accepts (the ESPN /teams abbreviation). */
  abbreviation: string;
  name: string;
  /** Config aliases that resolve to this team (never the abbreviation itself). */
  aliases: string[];
  favorite: boolean;
}

/** One row per team, alphabetical by name. `aliases` is the league config's
 *  alias → ESPN abbreviation map; `favoriteIds` the starred teams' ESPN ids. */
export function teamRows(
  teams: readonly EspnTeam[],
  aliases: Record<string, string>,
  favoriteIds: ReadonlySet<string>,
): TeamRow[] {
  return teams
    .map((t) => {
      const code = t.abbreviation.toLowerCase();
      return {
        id: t.id,
        abbreviation: t.abbreviation,
        name: t.name,
        aliases: Object.entries(aliases)
          .filter(([k, v]) => v.toLowerCase() === code && k.toLowerCase() !== code)
          .map(([k]) => k),
        favorite: favoriteIds.has(t.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Aligned plain-text table: `★ CODE  Name  (alias, alias)`. The star column is
 *  always reserved so rows line up whether or not anything is a favorite. */
export function renderTeamRows(rows: readonly TeamRow[]): string {
  const codeW = Math.max(0, ...rows.map((r) => r.abbreviation.length));
  const nameW = Math.max(0, ...rows.map((r) => r.name.length));
  return rows
    .map((r) => {
      const aliases = r.aliases.length > 0 ? `aka ${r.aliases.join(", ")}` : "";
      return `${r.favorite ? "★" : " "} ${r.abbreviation.padEnd(codeW)}  ${r.name.padEnd(nameW)}  ${aliases}`.trimEnd();
    })
    .join("\n");
}
