import { homedir } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

const CONFIG_DIR = join(homedir(), ".config", "sportsball");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CACHE_DIR = join(homedir(), ".cache", "sportsball");

interface Config {
  apiKey?: string;
}

async function readConfig(): Promise<Config> {
  try {
    return await Bun.file(CONFIG_FILE).json();
  } catch {
    return {};
  }
}

/** Resolve the football-data.org API key from env or config file. */
export async function getApiKey(): Promise<string | null> {
  const env = process.env.FOOTBALL_DATA_API_KEY?.trim();
  if (env) return env;
  const cfg = await readConfig();
  return cfg.apiKey?.trim() || null;
}

export async function setApiKey(key: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const cfg = await readConfig();
  cfg.apiKey = key.trim();
  await Bun.write(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

export { CONFIG_FILE };
