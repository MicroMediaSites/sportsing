import { test, expect } from "bun:test";
// Pure helpers only — never launches a window or touches ~/.config/sportsing.
import { PROVIDERS, pickProvider } from "./stream.ts";
import { waitPollMs } from "./commands/watch.ts";

test("pickProvider: per-sport hubs — Fubo has FIFA and NBA hubs", () => {
  const fifa = pickProvider("fubo", "fifa");
  expect(fifa).toEqual({ ok: true, key: "fubo", label: "Fubo", hub: "https://www.fubo.tv/p/world-cup" });
  const nba = pickProvider("FUBO", "nba");
  expect(nba.ok && nba.hub).toBe(PROVIDERS.fubo!.hubs.nba!);
});

test("pickProvider: FIFA keeps both World Cup providers", () => {
  expect(pickProvider("peacock", "fifa").ok).toBe(true);
  const bad = pickProvider("hulu", "fifa");
  expect(bad).toEqual({ ok: false, error: 'Unknown provider "hulu". Known: peacock, fubo.' });
});

test("pickProvider: a provider with no hub for the sport is refused, naming the ones that have one", () => {
  expect(pickProvider("peacock", "nba")).toEqual({ ok: false, error: "Peacock has no nba hub. Known for nba: fubo." });
  expect(pickProvider("fubo", "nhl")).toEqual({ ok: false, error: "Fubo has no nhl hub. Known for nhl: none." });
});

test("waitPollMs: 60s normally, 30s inside 15 min, 15s inside 5 min and once past start", () => {
  expect(waitPollMs(60 * 60_000)).toBe(60_000);
  expect(waitPollMs(10 * 60_000)).toBe(30_000);
  expect(waitPollMs(2 * 60_000)).toBe(15_000);
  expect(waitPollMs(-60_000)).toBe(15_000);
});
