// Placeholder for AGT-1719 (`stats A B` and `stats --ahead`); the dispatch in
// src/commands/league.ts already routes here. Replace the bodies, keep the
// signatures.

import { c } from "./ansi.ts";
import type { LeagueConfig } from "./commands/league.ts";

export async function compareCommand(cfg: LeagueConfig, a: string, b: string, opts: { json: boolean }): Promise<void> {
  void opts;
  console.log(c.dim(`${cfg.label} stats ${a} vs ${b}: coming soon.`));
}

export async function aheadCommand(cfg: LeagueConfig, team: string | null, opts: { json: boolean }): Promise<void> {
  void opts;
  console.log(c.dim(`${cfg.label} stats --ahead${team ? ` ${team}` : ""}: coming soon.`));
}
