import { test, expect } from "bun:test";
// Pure helpers only — these tests never read or write ~/.config/sportsing.
import { parseFavorite, formatFavorite, favoritesFor, withFavorite, withoutFavorite } from "./config.ts";

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
