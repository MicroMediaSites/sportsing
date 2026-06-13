import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "sportsball");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CACHE_DIR = join(homedir(), ".cache", "sportsball");

interface Config {
  apiKey?: string;
  favorites?: string[];
  /** Preferred streaming provider for `fifa watch` (peacock | fubo). */
  streamProvider?: string;
}

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
