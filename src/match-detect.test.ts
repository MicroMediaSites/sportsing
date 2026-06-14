import { test, expect } from "bun:test";
import { detectFromTitle } from "./match-detect.ts";

test("Spanish team names → spanish cast", () => {
  const ctx = detectFromTitle("Catar v. Suiza - Peacock");
  expect(ctx).toMatchObject({ kind: "match", lang: "spanish" });
});

test("English team names on Fubo → english cast", () => {
  const ctx = detectFromTitle("Qatar vs Switzerland - fubo.tv");
  expect(ctx).toMatchObject({ kind: "match", lang: "english" });
});

test("Spanish names on Fubo (Telemundo airing) → spanish cast", () => {
  const ctx = detectFromTitle("Alemania v. Francia - Fubo");
  expect(ctx).toMatchObject({ kind: "match", lang: "spanish" });
});

test("Peacock with language-neutral names → spanish (Telemundo-only feed)", () => {
  const ctx = detectFromTitle("Argentina v. Portugal - Peacock");
  expect(ctx).toMatchObject({ kind: "match", lang: "spanish" });
});

test("Fubo with only language-neutral names → undeterminable (no lang, so no false warning)", () => {
  const ctx = detectFromTitle("Argentina vs Portugal - fubo.tv");
  expect(ctx.kind).toBe("match");
  expect((ctx as { lang?: string }).lang).toBeUndefined();
});

test("still classifies the hub as today and keeps team canonicalization", () => {
  expect(detectFromTitle("FIFA World Cup 2026 - Fubo").kind).toBe("today");
  expect(detectFromTitle("Catar v. Suiza - Peacock")).toMatchObject({ teams: ["QAT", "SUI"] });
});
