// Pure, dependency-light helpers over the Match shape. Lives at the top level
// (not under commands/) so both the command layer (_lib.ts) and pure modules
// like events.ts can share one source of truth without events.ts taking a
// dependency on the I/O-bearing command layer.

import type { Match } from "./types.ts";

/** True if either side of the match matches `needle` (lowercased) by name/tla/shortName. */
export function matchHasTeam(m: Match, needle: string): boolean {
  const fields = [
    m.homeTeam.name,
    m.homeTeam.tla,
    m.homeTeam.shortName,
    m.awayTeam.name,
    m.awayTeam.tla,
    m.awayTeam.shortName,
  ];
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
