import { homedir } from "os";
import { join } from "path";
import { mkdir, chmod } from "fs/promises";
import { SUBSCRIPTIONS, HOME_MARKETS, DEFAULT_HOME_MARKET, isSubscription, type Subscription } from "./watchability.ts";

const CONFIG_DIR = join(homedir(), ".config", "sportsing");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CACHE_DIR = join(homedir(), ".cache", "sportsing");

// Pre-rebrand location (was `sportsball`). Read as a one-time fallback so existing
// favorites / API key survive the rename; the next writeConfig() persists forward
// to CONFIG_FILE. Cache (bus/pidfile/ESPN) is ephemeral, so it isn't migrated.
const LEGACY_CONFIG_FILE = join(homedir(), ".config", "sportsball", "config.json");

interface Config {
  apiKey?: string;
  /** Sport-scoped favorites, `<sport>:<team>` (e.g. `nba:UTAH`, `fifa:USA`).
   *  Legacy unprefixed entries (pre-NBA/NHL) read as `fifa:<team>`. */
  favorites?: string[];
  /** Preferred streaming provider for `fifa watch` (peacock | fubo). Predates
   *  per-sport providers, so it only ever applies to fifa. */
  streamProvider?: string;
  /** Preferred streaming provider per sport for `<sport> watch`, e.g.
   *  `{ "nba": "fubo" }`. Overrides the sport's built-in default. */
  streamProviders?: Record<string, string>;
  /** Calibrated overlay delay (seconds) per provider, to sync stats to the stream. */
  streamDelay?: Record<string, number>;
  /** Overlay panel choices (the gear/settings) — per provider → { panel: on }. */
  overlayPanels?: Record<string, Record<string, boolean>>;
  /** What the user can watch with (see SUBSCRIPTIONS in watchability.ts). */
  subscriptions?: string[];
  /** HOME_MARKETS id for blackouts / local channels; defaults to Utah. */
  homeMarket?: string;
}

/** Default overlay panel visibility — nothing on by default, so a fresh stream
 *  shows JUST the floating gear; every panel is opt-in via the settings modal. */
export const OVERLAY_PANEL_DEFAULTS: Record<string, boolean> = {
  score: false, // score · clock · favorite win%
  stats: false, // possession / shots / on-target
  winprob: false, // 3-way win-probability breakdown
  odds: false, // raw 3-way odds line
  h2h: false, // head-to-head button
  events: false, // live match events (goals/cards/subs)
  scores: false, // other live matches
  ask: false, // "Ask Claude" — routed through the external agent bus
  catchup: false, // "Get caught up" recap button — routed through the external agent bus
};

async function readConfig(): Promise<Config> {
  try {
    return await Bun.file(CONFIG_FILE).json();
  } catch {
    try {
      // One-time fallback to the pre-rebrand config; writeConfig migrates it forward.
      return await Bun.file(LEGACY_CONFIG_FILE).json();
    } catch {
      return {};
    }
  }
}

async function writeConfig(cfg: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
  // The config holds the user's football-data.org API key — keep it owner-only
  // (0600) so other local users can't read it. Best-effort (no-op on Windows).
  await chmod(CONFIG_FILE, 0o600).catch(() => {});
}

/** Resolve the football-data.org API key from env or config file. */
export async function getApiKey(): Promise<string | null> {
  const env = process.env.FOOTBALL_DATA_API_KEY?.trim();
  if (env) return env;
  const cfg = await readConfig();
  return cfg.apiKey?.trim() || null;
}

export async function setApiKey(key: string): Promise<void> {
  const cfg = await readConfig();
  cfg.apiKey = key.trim();
  await writeConfig(cfg);
}

/** A sport's configured streaming provider (lowercased), or null if unset:
 *  `streamProviders[sport]`, falling back to the legacy `streamProvider` for
 *  fifa only. Pure over the parsed config. */
export function streamProviderFor(cfg: Pick<Config, "streamProvider" | "streamProviders">, sport: string): string | null {
  const s = sport.trim().toLowerCase();
  const v = cfg.streamProviders?.[s] ?? (s === "fifa" ? cfg.streamProvider : undefined);
  return v?.trim().toLowerCase() || null;
}

/** Preferred streaming provider for `<sport> watch`, or null if unset. */
export async function getStreamProvider(sport: string): Promise<string | null> {
  return streamProviderFor(await readConfig(), sport);
}

export async function setStreamProvider(provider: string): Promise<void> {
  const cfg = await readConfig();
  cfg.streamProvider = provider.trim().toLowerCase();
  await writeConfig(cfg);
}

/** Calibrated overlay delay (seconds) for a provider, or null if not set. */
export async function getStreamDelay(provider: string): Promise<number | null> {
  const cfg = await readConfig();
  const v = cfg.streamDelay?.[provider.trim().toLowerCase()];
  return typeof v === "number" ? v : null;
}

export async function setStreamDelay(provider: string, seconds: number): Promise<void> {
  const cfg = await readConfig();
  cfg.streamDelay = { ...(cfg.streamDelay ?? {}), [provider.trim().toLowerCase()]: Math.max(0, Math.round(seconds)) };
  await writeConfig(cfg);
}

/** Overlay panel visibility for a provider (defaults merged with saved choices). */
export async function getOverlayPanels(provider: string): Promise<Record<string, boolean>> {
  const cfg = await readConfig();
  const saved = cfg.overlayPanels?.[provider.trim().toLowerCase()] ?? {};
  return { ...OVERLAY_PANEL_DEFAULTS, ...saved };
}

export async function setOverlayPanel(provider: string, key: string, on: boolean): Promise<void> {
  const cfg = await readConfig();
  const p = provider.trim().toLowerCase();
  const all = cfg.overlayPanels ?? {};
  cfg.overlayPanels = { ...all, [p]: { ...(all[p] ?? {}), [key]: on } };
  await writeConfig(cfg);
}

// ── Favorites ────────────────────────────────────────────────────────────────
// Stored as `<sport>:<team>` because team abbreviations collide across sports
// (the Jazz and the Mammoth are both ESPN `UTAH`). Entries written before
// sports were scoped are bare team names and are read as `fifa:<team>`; the
// next write rewrites them in prefixed form.

/** The sport a legacy (unprefixed) favorite belongs to. */
export const LEGACY_FAVORITE_SPORT = "fifa";

/** A stored favorite entry, split into its sport and team. */
export interface Favorite {
  sport: string;
  team: string;
}

/** Sport prefixes are short lowercase ids (`fifa`, `nba`, `nhl`). */
const PREFIXED = /^([a-z][a-z0-9]*):(.+)$/;

/** Parse a stored entry; unprefixed (legacy) entries are FIFA teams. */
export function parseFavorite(entry: string): Favorite {
  const m = PREFIXED.exec(entry.trim());
  if (m) return { sport: m[1]!, team: m[2]!.trim() };
  return { sport: LEGACY_FAVORITE_SPORT, team: entry.trim() };
}

/** Serialize a favorite to its stored `<sport>:<team>` form. */
export function formatFavorite(f: Favorite): string {
  return `${f.sport}:${f.team}`;
}

const normSport = (sport: string) => sport.trim().toLowerCase();
const sameTeam = (a: string, b: string) => a.toLowerCase() === b.trim().toLowerCase();

// Pure helpers over the stored entry list (unit-tested without touching disk).

/** A sport's team names from stored entries, in insertion order. */
export function favoritesFor(entries: string[], sport: string): string[] {
  const s = normSport(sport);
  return entries
    .filter((e) => e.trim())
    .map(parseFavorite)
    .filter((f) => f.sport === s)
    .map((f) => f.team);
}

/** Stored entries with `team` added for `sport` (unless an equal name exists in
 *  that sport, case-insensitive). Output is fully prefixed — legacy migrates. */
export function withFavorite(entries: string[], sport: string, team: string): { added: boolean; entries: string[] } {
  const s = normSport(sport);
  const name = team.trim();
  const all = entries.filter((e) => e.trim()).map(parseFavorite);
  const exists = all.some((f) => f.sport === s && sameTeam(f.team, name));
  if (!exists) all.push({ sport: s, team: name });
  return { added: !exists, entries: all.map(formatFavorite) };
}

/** Stored entries with `sport`'s `team` removed (case-insensitive); other
 *  sports are untouched. Output is fully prefixed — legacy migrates. */
export function withoutFavorite(entries: string[], sport: string, team: string): { removed: boolean; entries: string[] } {
  const s = normSport(sport);
  const all = entries.filter((e) => e.trim()).map(parseFavorite);
  const i = all.findIndex((f) => f.sport === s && sameTeam(f.team, team));
  if (i >= 0) all.splice(i, 1);
  return { removed: i >= 0, entries: all.map(formatFavorite) };
}

/** A sport's favorite team names, in the order they were added (as typed). */
export async function getFavorites(sport: string): Promise<string[]> {
  const cfg = await readConfig();
  return favoritesFor(cfg.favorites ?? [], sport);
}

/** Add a favorite team for a sport. No-op (added=false) if that sport already
 *  has an equal name. Returns that sport's favorites. */
export async function addFavorite(sport: string, team: string): Promise<{ added: boolean; favorites: string[] }> {
  const cfg = await readConfig();
  const { added, entries } = withFavorite(cfg.favorites ?? [], sport, team);
  cfg.favorites = entries;
  await writeConfig(cfg);
  return { added, favorites: favoritesFor(entries, sport) };
}

/** Remove a sport's favorite team (case-insensitive). removed=false if it
 *  wasn't there. Returns that sport's favorites. */
export async function removeFavorite(sport: string, team: string): Promise<{ removed: boolean; favorites: string[] }> {
  const cfg = await readConfig();
  const { removed, entries } = withoutFavorite(cfg.favorites ?? [], sport, team);
  cfg.favorites = entries;
  await writeConfig(cfg);
  return { removed, favorites: favoritesFor(entries, sport) };
}

// ── Subscriptions + home market ──────────────────────────────────────────────
// Pure helpers over raw input / stored values (unit-tested without touching
// disk); the async get/set pair below is the IO edge.

/** Parse user input (space- and/or comma-separated ids, any case) into
 *  subscriptions in canonical order, deduped, plus anything unrecognized. */
export function parseSubscriptions(input: string[]): { subscriptions: Subscription[]; invalid: string[] } {
  const tokens = input.flatMap((a) => a.split(",")).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const invalid = [...new Set(tokens.filter((t) => !isSubscription(t)))];
  const subscriptions = SUBSCRIPTIONS.filter((s) => tokens.includes(s));
  return { subscriptions, invalid };
}

/** Stored subscriptions, dropping anything no longer recognized. */
export function subscriptionsOf(stored: unknown): Subscription[] {
  if (!Array.isArray(stored)) return [];
  return parseSubscriptions(stored.filter((s): s is string => typeof s === "string")).subscriptions;
}

/** Normalize a home-market id; null if it isn't a known market. */
export function parseHomeMarket(input: string): string | null {
  const id = input.trim().toLowerCase();
  return Object.hasOwn(HOME_MARKETS, id) ? id : null;
}

/** Stored home market, falling back to the default for unset/unknown values. */
export function homeMarketOf(stored: unknown): string {
  return (typeof stored === "string" && parseHomeMarket(stored)) || DEFAULT_HOME_MARKET;
}

export async function getSubscriptions(): Promise<Subscription[]> {
  return subscriptionsOf((await readConfig()).subscriptions);
}

export async function setSubscriptions(subscriptions: Subscription[]): Promise<void> {
  const cfg = await readConfig();
  cfg.subscriptions = [...subscriptions];
  await writeConfig(cfg);
}

export async function getHomeMarket(): Promise<string> {
  return homeMarketOf((await readConfig()).homeMarket);
}

/** `market` must be a known HOME_MARKETS id (see parseHomeMarket). */
export async function setHomeMarket(market: string): Promise<void> {
  const cfg = await readConfig();
  cfg.homeMarket = market;
  await writeConfig(cfg);
}

export { CONFIG_FILE };
