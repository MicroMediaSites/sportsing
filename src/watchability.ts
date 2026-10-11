// "Can I watch it?" — resolve a game's broadcasts against the user's
// subscriptions and home market.
//
// Pure: no IO, no config reads. Callers pass the subscriptions and home market
// (from config.ts) and the sport the game belongs to. The broadcaster catalog
// below is best-effort knowledge of who carries what; anything not in it
// resolves to `watchable: "unknown"` — never a guessed yes.

import type { Broadcast, Game, GameCompetitor } from "./game.ts";

/** Services / reception the user can have. Order is the routing preference:
 *  an openable service beats a channel you have to tune an antenna to. */
export const SUBSCRIPTIONS = ["fubo", "prime-video", "peacock", "paramount-plus", "nba-league-pass", "local-ota"] as const;
export type Subscription = (typeof SUBSCRIPTIONS)[number];

export const SUBSCRIPTION_LABELS: Record<Subscription, string> = {
  fubo: "Fubo",
  "prime-video": "Prime Video",
  peacock: "Peacock",
  "paramount-plus": "Paramount+",
  "nba-league-pass": "NBA League Pass",
  "local-ota": "over the air",
};

export function isSubscription(s: string): s is Subscription {
  return (SUBSCRIPTIONS as readonly string[]).includes(s);
}

/** Sports the resolver knows how to route (ESPN-backed, `Game`-shaped). */
export type WatchSport = "nba" | "nhl" | "epl" | "seriea" | "ligue1";

/** Club-soccer leagues: no home market (every listed broadcast is national)
 *  and no blackouts. */
const CLUB_SOCCER: readonly WatchSport[] = ["epl", "seriea", "ligue1"];
const isSoccer = (sport: WatchSport) => CLUB_SOCCER.includes(sport);

/** What an unlisted match (ESPN lists no broadcasts at all) is assumed to be
 *  on, per sport — the same guess League Pass gets for NBA, shown as "no
 *  broadcast listed yet (assumed)". Only applies when the user has `service`;
 *  otherwise the match stays unknown. Serie A has none: every match lists
 *  Paramount+. */
export const ASSUMED_WHEN_UNLISTED: Partial<Record<WatchSport, { service: Subscription; channel: string }>> = {
  epl: { service: "peacock", channel: "Peacock" },
  // beIN Sports holds the exclusive US rights; Fubo carries it.
  ligue1: { service: "fubo", channel: "beIN Sports" },
};

export interface HomeMarket {
  name: string;
  /** ESPN team ids of this market's local teams, per sport. Ids, not
   *  abbreviations: the Mammoth are `UTAH` in /teams but `UTA` in schedules.
   *  Club soccer has no entries: it has no home market. */
  teams: Partial<Record<WatchSport, string[]>>;
  /** Local-market channels (lowercased name → subscriptions that carry it).
   *  `[]` = known, but none of the supported subscriptions carry it. */
  channels: Record<string, Subscription[]>;
}

export const HOME_MARKETS: Record<string, HomeMarket> = {
  utah: {
    name: "Utah",
    teams: { nba: ["26"], nhl: ["129764"] },
    channels: {
      // Jazz: KJZZ is a broadcast station (OTA ch. 14) that Fubo carries in-market.
      "kjzz-tv": ["fubo", "local-ota"],
      kjzz: ["fubo", "local-ota"],
      "jazz+": [], // the team's own streaming app
      // Mammoth: Utah 16 (KUPX) is a broadcast station (OTA ch. 16) that Fubo
      // also carries in-market. ESPN lists it as "Utah 16"; the call-sign
      // spellings are aliases.
      "utah 16": ["fubo", "local-ota"],
      kupx: ["fubo", "local-ota"],
      "kupx-tv": ["fubo", "local-ota"],
      "mammoth+": [], // the team's own streaming app
    },
  },
};

export const DEFAULT_HOME_MARKET = "utah";

/** National networks / services (lowercased name → carriers). Broadcast
 *  networks (ABC/NBC/CBS/FOX) come in over the air anywhere. */
const NATIONAL: Record<string, Subscription[]> = {
  espn: ["fubo"],
  espn2: ["fubo"],
  abc: ["fubo", "local-ota"],
  nbc: ["fubo", "local-ota"],
  cbs: ["fubo", "local-ota"],
  fox: ["fubo", "local-ota"],
  fs1: ["fubo"],
  "nba tv": ["fubo"],
  "nhl net": ["fubo"],
  "nhl network": ["fubo"],
  // Club soccer (ESPN's names, lowercased).
  "usa net": ["fubo"],
  "usa network": ["fubo"],
  cbssn: ["fubo"],
  "cbs sports network": ["fubo"],
  "bein sports": ["fubo"],
  "bein sports en español": ["fubo"],
  "bein sports en espanol": ["fubo"],
  universo: ["fubo"],
  telemundo: ["fubo", "local-ota"],
  peacock: ["peacock"],
  "paramount+": ["paramount-plus"],
  "paramount plus": ["paramount-plus"],
  tubi: [], // known, none of the supported subscriptions carry it
  // Known, but none of the supported subscriptions carry them.
  "espn+": [],
  tnt: [],
  trutv: [],
  "hbo max": [],
  max: [],
  // Amazon's own national NBA package (2025–26 on) — not League Pass.
  "prime video": ["prime-video"],
  "amazon prime video": ["prime-video"],
  "disney+": [],
  hulu: [],
  "apple tv": [],
};

/** ESPN lists League Pass itself as a broadcast row; it's a subscription, not
 *  a channel, so it's routed by the League Pass rule, not the catalog. */
const LEAGUE_PASS_ROW = "nba league pass";

export interface Watchability {
  watchable: boolean | "unknown";
  /** What to watch on: a service label ("Fubo", "NBA League Pass") or, for
   *  over-the-air, the channel name ("Utah 16"). null unless watchable. */
  via: string | null;
  /** The subscription that makes it watchable; null unless watchable. */
  service: Subscription | null;
  /** One-line human explanation (channel, blackout, exclusivity, …). */
  note: string;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Resolve where (whether) `game` can be watched with `subscriptions` from
 * `homeMarket` (a HOME_MARKETS id). `sport` is needed because ESPN team ids
 * are per league and League Pass is NBA-only.
 *
 * - National broadcasts are reachable anywhere; a home/away-market broadcast
 *   only when that team is a home-market team (other markets' regional feeds
 *   are geo-locked and ignored).
 * - NBA League Pass covers out-of-market games, blacked out when a home-market
 *   team plays or the game has any national broadcast. An out-of-market game
 *   with no broadcasts listed at all (common in preseason) is assumed to be on
 *   League Pass — the one guess, since nearly every such game is.
 * - Any relevant broadcaster not in the catalog makes the answer "unknown"
 *   unless a known route already works — never a false yes.
 */
export function resolveWatch(
  game: Game,
  subscriptions: readonly Subscription[],
  homeMarket: string,
  sport: WatchSport,
): Watchability {
  // hasOwn: a bare lookup would accept prototype keys like "constructor".
  const market = Object.hasOwn(HOME_MARKETS, homeMarket) ? HOME_MARKETS[homeMarket] : undefined;
  if (!market) return unknown(`unknown home market "${homeMarket}"`);

  const has = new Set(subscriptions);
  const soccer = isSoccer(sport);
  const local = market.teams[sport] ?? [];
  const isLocal = (t: GameCompetitor) => t.id !== "" && local.includes(t.id);
  const localTeam = isLocal(game.home) ? game.home : isLocal(game.away) ? game.away : null;

  const listed = game.broadcasts.filter((b) => key(b.name) !== LEAGUE_PASS_ROW);
  const reachable = listed.filter(
    (b) => b.market === "national" || soccer || (b.market === "home" && isLocal(game.home)) || (b.market === "away" && isLocal(game.away)),
  );

  const routes: { service: Subscription; channel: string; assumed?: boolean }[] = [];
  const unrecognized: Broadcast[] = [];
  const notCarried: Broadcast[] = [];
  for (const b of reachable) {
    const carriers = b.market === "national" || soccer ? NATIONAL[key(b.name)] : market.channels[key(b.name)];
    if (!carriers) {
      unrecognized.push(b);
      continue;
    }
    const ours = carriers.filter((s) => has.has(s));
    if (ours.length) for (const s of ours) routes.push({ service: s, channel: b.name });
    else notCarried.push(b);
  }

  // League Pass: out-of-market NBA only, and only when the listing shows no
  // national broadcast (national games are blacked out). An empty listing
  // counts as League Pass: such games almost always are, and a wrong guess
  // just opens the League Pass hub.
  const blackedOut = sport === "nba" && has.has("nba-league-pass") && localTeam !== null;
  if (
    sport === "nba" &&
    has.has("nba-league-pass") &&
    localTeam === null &&
    !listed.some((b) => b.market === "national")
  ) {
    routes.push({ service: "nba-league-pass", channel: SUBSCRIPTION_LABELS["nba-league-pass"] });
  }

  // Club soccer: a match ESPN lists nothing for is assumed to be on the
  // league's usual home (Premier League → Peacock, Ligue 1 → beIN on Fubo).
  const assumed = ASSUMED_WHEN_UNLISTED[sport];
  if (assumed && game.broadcasts.length === 0 && has.has(assumed.service)) {
    routes.push({ ...assumed, assumed: true });
  }

  if (routes.length) {
    const best = routes.sort((a, b) => SUBSCRIPTIONS.indexOf(a.service) - SUBSCRIPTIONS.indexOf(b.service))[0]!;
    if (best.service === "local-ota") return { watchable: true, via: best.channel, service: best.service, note: `${best.channel} — over the air` };
    if (best.service === "nba-league-pass") {
      const note = game.broadcasts.length ? "out-of-market on League Pass" : "no broadcast listed yet (assumed)";
      return { watchable: true, via: best.channel, service: best.service, note };
    }
    const note = best.assumed ? "no broadcast listed yet (assumed)" : `on ${best.channel}`;
    return { watchable: true, via: SUBSCRIPTION_LABELS[best.service], service: best.service, note };
  }

  if (game.broadcasts.length === 0) return unknown("no broadcasts listed yet");
  if (unrecognized.length) return unknown(`unrecognized broadcaster: ${names(unrecognized)}`);
  if (blackedOut) {
    const elsewhere = notCarried.length ? ` (also on ${names(notCarried)} — no subscription)` : "";
    return no(`League Pass blacks out in-market ${localTeam!.name} games${elsewhere}`);
  }
  if (notCarried.length) return no(`${names(notCarried)} exclusive — no subscription`);
  // Nothing reachable: either a home-market team's local feed isn't listed
  // (can't rule it out) or the game only airs on other markets' regional TV.
  if (localTeam) return unknown(`no ${market.name} broadcast listed for ${localTeam.name}`);
  if (listed.length === 0) return no("only on NBA League Pass — no subscription");
  return no(`only on out-of-market regional TV (${names(listed)})`);
}

const names = (bs: Broadcast[]) => [...new Set(bs.map((b) => b.name))].join(" / ");
const unknown = (note: string): Watchability => ({ watchable: "unknown", via: null, service: null, note });
const no = (note: string): Watchability => ({ watchable: false, via: null, service: null, note });
