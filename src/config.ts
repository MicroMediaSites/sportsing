import { homedir } from "os";
import { join } from "path";
import { mkdir, chmod } from "fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "sportsball");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CACHE_DIR = join(homedir(), ".cache", "sportsball");

interface Config {
  apiKey?: string;
  favorites?: string[];
  /** Preferred streaming provider for `fifa watch` (peacock | fubo). */
  streamProvider?: string;
  /** Calibrated overlay delay (seconds) per provider, to sync stats to the stream. */
  streamDelay?: Record<string, number>;
  /** Overlay panel choices (the gear/settings) — per provider → { panel: on }. */
  overlayPanels?: Record<string, Record<string, boolean>>;
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
    return {};
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

/** Preferred streaming provider for `fifa watch`, or null if unset. */
export async function getStreamProvider(): Promise<string | null> {
  const cfg = await readConfig();
  return cfg.streamProvider?.trim().toLowerCase() || null;
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

/** Favorite teams, in the order they were added (as the user typed them). */
export async function getFavorites(): Promise<string[]> {
  const cfg = await readConfig();
  return cfg.favorites ?? [];
}

/** Add a favorite team. No-op (added=false) if an equal name already exists. */
export async function addFavorite(team: string): Promise<{ added: boolean; favorites: string[] }> {
  const name = team.trim();
  const cfg = await readConfig();
  const favorites = cfg.favorites ?? [];
  const exists = favorites.some((f) => f.toLowerCase() === name.toLowerCase());
  if (!exists) favorites.push(name);
  cfg.favorites = favorites;
  await writeConfig(cfg);
  return { added: !exists, favorites };
}

/** Remove a favorite team (case-insensitive). removed=false if it wasn't there. */
export async function removeFavorite(team: string): Promise<{ removed: boolean; favorites: string[] }> {
  const cfg = await readConfig();
  const favorites = cfg.favorites ?? [];
  const i = favorites.findIndex((f) => f.toLowerCase() === team.trim().toLowerCase());
  const removed = i >= 0;
  if (removed) favorites.splice(i, 1);
  cfg.favorites = favorites;
  await writeConfig(cfg);
  return { removed, favorites };
}

export { CONFIG_FILE };
