// Shapes from football-data.org v4 (subset we use).

export interface Team {
  id?: number;
  name: string | null;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
}

export type MatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "AWARDED";

export type Stage =
  | "GROUP_STAGE"
  | "LAST_32"
  | "LAST_16"
  | "QUARTER_FINALS"
  | "SEMI_FINALS"
  | "THIRD_PLACE"
  | "FINAL";

export interface Score {
  winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
  duration?: string;
  fullTime: { home: number | null; away: number | null };
  halfTime?: { home: number | null; away: number | null };
}

export interface Match {
  id: number;
  utcDate: string;
  status: MatchStatus;
  stage: Stage;
  group: string | null;
  matchday: number | null;
  homeTeam: Team;
  awayTeam: Team;
  score: Score;
  venue?: string | null;
  minute?: number | null;
}

export interface MatchesResponse {
  matches: Match[];
  resultSet?: { count: number };
}

export interface StandingRow {
  position: number;
  team: Team;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface StandingsTable {
  stage: Stage;
  type: "TOTAL" | "HOME" | "AWAY";
  group: string | null;
  table: StandingRow[];
}

export interface StandingsResponse {
  standings: StandingsTable[];
}

export interface Scorer {
  player: { name: string };
  team: Team;
  goals: number | null;
  assists: number | null;
  penalties: number | null;
}

export interface ScorersResponse {
  scorers: Scorer[];
}
