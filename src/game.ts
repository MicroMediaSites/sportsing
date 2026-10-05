// Sport-neutral game shape for the ESPN-backed leagues (NBA, NHL, …).
//
// `types.ts` is football-data.org's soccer shape (goals, groups, stages) and
// stays the World Cup path's model. NBA/NHL commands consume `Game` instead:
// periods + a clock, a season phase (preseason through postseason), and the
// per-game broadcast list that drives "can I watch it". Source-specific
// parsing lives with its source (ESPN → `toGame` in espn.ts); nothing here
// knows about any API.

/** "pre" (scheduled), "in" (live), "post" (finished). */
export type GameState = "pre" | "in" | "post";

export type SeasonPhase = "preseason" | "regular" | "postseason";

/** Who a broadcast is aimed at: everywhere, or one team's home market. */
export type BroadcastMarket = "national" | "home" | "away";

export interface Broadcast {
  /** Network / service name as listed, e.g. "Utah 16", "ESPN+", "NBA TV". */
  name: string;
  market: BroadcastMarket;
}

export interface GameCompetitor {
  /** Source team id (ESPN: Jazz "26", Mammoth "129764"); "" when unknown. */
  id: string;
  /** Full name, e.g. "Utah Jazz". */
  name: string;
  abbreviation: string;
  /** Score as displayed; "" before the game starts. */
  score: string;
}

export interface Game {
  id: string;
  /** ISO start time. */
  date: string;
  /** e.g. "Utah Jazz at Denver Nuggets". */
  name: string;
  state: GameState;
  /** Short status text from the source, e.g. "Final/OT", "10/6 - 9:00 PM EDT". */
  detail: string;
  /** Current (live) or last (final) period; 0 before the game starts. */
  period: number;
  /** Game clock while live (e.g. "4:21"); "" when not in progress. */
  clock: string;
  seasonType: SeasonPhase;
  home: GameCompetitor;
  away: GameCompetitor;
  broadcasts: Broadcast[];
}
