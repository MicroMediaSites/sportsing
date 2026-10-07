import { describe, expect, test } from "bun:test";
import { JS_SPLIT_MATCHUP, leagueTileTerms } from "./deep-link.ts";

// The exact page-side source the tile matcher runs.
const split = new Function("t", JS_SPLIT_MATCHUP + "\nreturn split(t);") as (t: string) => [string, string] | null;

describe("split (page-side matchup splitter)", () => {
  test("Fubo NBA/NHL tiles: 'Away at Home'", () => {
    expect(split("denver nuggets at utah jazz")).toEqual(["denver nuggets", "utah jazz"]);
    expect(split("utah mammoth at new jersey devils")).toEqual(["utah mammoth", "new jersey devils"]);
    expect(split("utah mammoth @ new jersey devils")).toEqual(["utah mammoth", "new jersey devils"]);
  });

  test("soccer hubs: v / v. / vs / vs. / versus", () => {
    expect(split("usa v. mexico")).toEqual(["usa", "mexico"]);
    expect(split("usa v mexico")).toEqual(["usa", "mexico"]);
    expect(split("usa vs mexico")).toEqual(["usa", "mexico"]);
    expect(split("usa vs. mexico")).toEqual(["usa", "mexico"]);
    expect(split("usa versus mexico")).toEqual(["usa", "mexico"]);
  });

  test("a 'v' form wins over 'at' when both appear", () => {
    expect(split("usa v mexico at sofi stadium")).toEqual(["usa", "mexico at sofi stadium"]);
  });

  test("not a matchup → null", () => {
    expect(split("live tv for you")).toBeNull();
    expect(split("at home")).toBeNull(); // separator at the start has no left side
  });
});

describe("leagueTileTerms", () => {
  test("full name only, lowercased and whitespace-collapsed", () => {
    expect(leagueTileTerms("Utah  Jazz ")).toEqual(["utah jazz"]);
    expect(leagueTileTerms("Denver Nuggets")).toEqual(["denver nuggets"]);
  });

  test("no name → no terms (never matches everything)", () => {
    expect(leagueTileTerms("")).toEqual([]);
    expect(leagueTileTerms("   ")).toEqual([]);
  });
});
