import { test, expect } from "bun:test";
// Pure helpers only — these tests never read or write ~/.config/sportsing.
import {
  parseFavorite,
  formatFavorite,
  favoritesFor,
  withFavorite,
  withoutFavorite,
  parseSubscriptions,
  subscriptionsOf,
  parseHomeMarket,
  homeMarketOf,
  streamProviderFor,
} from "./config.ts";

test("parseFavorite: prefixed entries split into sport + team", () => {
  expect(parseFavorite("nba:UTAH")).toEqual({ sport: "nba", team: "UTAH" });
  expect(parseFavorite("nhl:UTAH")).toEqual({ sport: "nhl", team: "UTAH" });
  expect(parseFavorite("fifa:South Korea")).toEqual({ sport: "fifa", team: "South Korea" });
});

test("parseFavorite: legacy unprefixed entries read as fifa", () => {
  expect(parseFavorite("USA")).toEqual({ sport: "fifa", team: "USA" });
  expect(parseFavorite("South Korea")).toEqual({ sport: "fifa", team: "South Korea" });
});

test("parse/format round-trip keeps a colon inside the team name", () => {
  expect(parseFavorite(formatFavorite({ sport: "fifa", team: "nba:UTAH" }))).toEqual({ sport: "fifa", team: "nba:UTAH" });
});

test("nba:UTAH and nhl:UTAH coexist and filter independently", () => {
  let entries: string[] = [];
  let r = withFavorite(entries, "nba", "UTAH");
  expect(r.added).toBe(true);
  r = withFavorite(r.entries, "nhl", "UTAH");
  expect(r.added).toBe(true);
  entries = r.entries;

  expect(entries).toEqual(["nba:UTAH", "nhl:UTAH"]);
  expect(favoritesFor(entries, "nba")).toEqual(["UTAH"]);
  expect(favoritesFor(entries, "nhl")).toEqual(["UTAH"]);
  expect(favoritesFor(entries, "fifa")).toEqual([]);

  // Removing one sport's UTAH leaves the other's alone.
  const rm = withoutFavorite(entries, "nba", "utah");
  expect(rm.removed).toBe(true);
  expect(favoritesFor(rm.entries, "nba")).toEqual([]);
  expect(favoritesFor(rm.entries, "nhl")).toEqual(["UTAH"]);
});

test("duplicate detection is per sport and case-insensitive", () => {
  const base = ["nba:UTAH"];
  expect(withFavorite(base, "NBA", "utah").added).toBe(false);
  expect(withFavorite(base, "nhl", "utah")).toEqual({ added: true, entries: ["nba:UTAH", "nhl:utah"] });
});

test("withoutFavorite only matches within the given sport", () => {
  expect(withoutFavorite(["nhl:UTAH"], "nba", "UTAH")).toEqual({ removed: false, entries: ["nhl:UTAH"] });
});

test("legacy unprefixed favorites read as fifa and migrate to prefixed on write", () => {
  const legacy = ["USA", "Brazil"];
  expect(favoritesFor(legacy, "fifa")).toEqual(["USA", "Brazil"]);
  expect(favoritesFor(legacy, "nba")).toEqual([]);

  const { entries } = withFavorite(legacy, "nba", "UTAH");
  expect(entries).toEqual(["fifa:USA", "fifa:Brazil", "nba:UTAH"]);
  // The FIFA view is identical before and after migration.
  expect(favoritesFor(entries, "fifa")).toEqual(["USA", "Brazil"]);

  // A legacy name still de-dupes / removes against fifa.
  expect(withFavorite(legacy, "fifa", "usa").added).toBe(false);
  expect(withoutFavorite(legacy, "fifa", "brazil")).toEqual({ removed: true, entries: ["fifa:USA"] });
});

test("blank entries are ignored", () => {
  expect(favoritesFor(["", "  ", "USA"], "fifa")).toEqual(["USA"]);
});

// ── Subscriptions + home market (pure helpers) ───────────────────────────────
test("parseSubscriptions: commas/spaces, any case, deduped, canonical order", () => {
  expect(parseSubscriptions(["local-ota,FUBO", "fubo", " nba-league-pass "])).toEqual({
    subscriptions: ["fubo", "nba-league-pass", "local-ota"],
    invalid: [],
  });
});

test("parseSubscriptions: reports unrecognized ids", () => {
  expect(parseSubscriptions(["fubo,espn+", "hulu", "espn+"])).toEqual({ subscriptions: ["fubo"], invalid: ["espn+", "hulu"] });
});

test("subscriptionsOf: tolerates missing / malformed stored values", () => {
  expect(subscriptionsOf(undefined)).toEqual([]);
  expect(subscriptionsOf("fubo")).toEqual([]);
  expect(subscriptionsOf(["fubo", 3, "gone-service", "local-ota"])).toEqual(["fubo", "local-ota"]);
});

test("home market: defaults to utah; only known markets parse", () => {
  expect(homeMarketOf(undefined)).toBe("utah");
  expect(homeMarketOf("atlantis")).toBe("utah");
  expect(homeMarketOf(" Utah ")).toBe("utah");
  expect(parseHomeMarket("UTAH")).toBe("utah");
  expect(parseHomeMarket("atlantis")).toBeNull();
  expect(parseHomeMarket("constructor")).toBeNull();
});

test("streamProviderFor: per-sport entry, lowercased; null when unset", () => {
  expect(streamProviderFor({ streamProviders: { nba: " Fubo " } }, "nba")).toBe("fubo");
  expect(streamProviderFor({}, "nba")).toBeNull();
  expect(streamProviderFor({ streamProviders: { nba: "  " } }, "nba")).toBeNull();
});

test("streamProviderFor: legacy streamProvider applies to fifa only; per-sport entry wins", () => {
  expect(streamProviderFor({ streamProvider: "peacock" }, "fifa")).toBe("peacock");
  expect(streamProviderFor({ streamProvider: "peacock" }, "nba")).toBeNull();
  expect(streamProviderFor({ streamProvider: "peacock", streamProviders: { fifa: "fubo" } }, "fifa")).toBe("fubo");
});
