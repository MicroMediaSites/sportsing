import { describe, expect, test } from "bun:test";
import { JS_SPLIT_MATCHUP, clubMatches, isParamountUrl, leagueTileTerms, pickParamountTarget } from "./deep-link.ts";
import fixture from "./fixtures/paramount-live-events.json";

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

describe("Paramount+ tile matching (AGT-1716)", () => {
  const { tiles, hero } = fixture;
  const pick = (a: string, b: string, h: string | null = hero) =>
    pickParamountTarget(tiles, h, leagueTileTerms(a), leagueTileTerms(b));
  const base = "https://www.paramountplus.com/live-tv/stream/";

  test("live Cagliari vs. Juventus → absolute tile href (either team order)", () => {
    const want = base + "serie-a/11111111-aaaa-4bbb-8ccc-000000000001";
    expect(pick("Cagliari", "Juventus")).toBe(want);
    expect(pick("Juventus", "Cagliari")).toBe(want);
  });

  test("name variants: Inter/Internazionale, Roma/AS Roma, PSG/Paris Saint-Germain", () => {
    expect(pick("Inter", "Roma")).toContain("22222222");
    expect(pick("Internazionale", "AS Roma")).toContain("22222222");
    expect(pick("PSG", "Lyon")).toContain("33333333");
    expect(pick("Paris Saint-Germain", "Olympique Lyonnais")).toContain("33333333"); // "lyon" is within "lyonnais"
  });

  test("no match → null; one team alone is not enough", () => {
    expect(pick("Milan", "Torino")).toBeNull();
    expect(pick("Cagliari", "Lazio")).toBeNull();
    expect(pickParamountTarget(tiles, hero, [], [])).toBeNull();
  });

  test("a live tile beats a non-live duplicate", () => {
    const dup = [{ title: "Napoli vs. Lazio", href: "/a/old", live: false }, { title: "Napoli vs. Lazio", href: "/a/new", live: true }];
    expect(pickParamountTarget(dup, null, ["napoli"], ["lazio"])).toBe("https://www.paramountplus.com/a/new");
  });

  test("non-live tile uses hero only when the uuid matches", () => {
    const t = [{ title: "Napoli vs. Lazio", href: "/live-tv/stream/serie-a/44444444-aaaa-4bbb-8ccc-000000000004", live: false }];
    expect(pickParamountTarget(t, "/live-tv/stream/serie-a/44444444-aaaa-4bbb-8ccc-000000000004/", ["napoli"], ["lazio"])).toEndWith("000000000004/");
    expect(pickParamountTarget(t, "/live-tv/stream/serie-a/99999999-aaaa-4bbb-8ccc-000000000009/", ["napoli"], ["lazio"])).toEndWith("000000000004");
  });

  test("clubMatches + host check", () => {
    expect(clubMatches("AS Roma", "Roma")).toBe(true);
    expect(clubMatches("Inter", "Internazionale")).toBe(true);
    expect(clubMatches("Roma", "Lazio")).toBe(false);
    expect(isParamountUrl("https://www.paramountplus.com/shows/serie-a/")).toBe(true);
    expect(isParamountUrl("https://www.fubo.tv/")).toBe(false);
  });
});
