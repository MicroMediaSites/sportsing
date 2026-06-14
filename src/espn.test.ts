import { test, expect } from "bun:test";
import { looksOff } from "./espn.ts";

// Minimal scoreboard-event shapes, just the fields looksOff inspects.
const liveEvent = (competitors: any[]) => ({
  competitions: [{ status: { type: { state: "in" } }, competitors }],
});
const preEvent = () => ({
  competitions: [{ status: { type: { state: "pre" } }, competitors: [] }],
});
const namedTeams = [{ team: { displayName: "United States" } }, { team: { name: "England" } }];

test("a well-formed scoreboard with a live match is fine", () => {
  expect(looksOff({ events: [liveEvent(namedTeams)] })).toBe(false);
});

test("a date with no matches (events: []) is NOT off — empty ≠ wrong", () => {
  expect(looksOff({ events: [] })).toBe(false);
});

test("a pre-kickoff match with no stats yet is NOT off (shape, not emptiness)", () => {
  expect(looksOff({ events: [preEvent()] })).toBe(false);
});

test("missing `events` key is off (the shape changed)", () => {
  expect(looksOff({})).toBe(true);
});

test("`events` present but not an array is off", () => {
  expect(looksOff({ events: { nope: true } })).toBe(true);
});

test("non-object / null responses are off", () => {
  expect(looksOff(null)).toBe(true);
  expect(looksOff("a string")).toBe(true);
});

test("an in-play match with zero competitors is off", () => {
  expect(looksOff({ events: [liveEvent([])] })).toBe(true);
});

test("an in-play match with unnamed (\"?\") teams is off", () => {
  expect(looksOff({ events: [liveEvent([{ team: {} }, { team: {} }])] })).toBe(true);
});

test("only live matches are structurally enforced — a malformed pre event doesn't trip it", () => {
  // pre match with empty competitors is normal (teams may render as TBD); not off.
  expect(looksOff({ events: [preEvent(), liveEvent(namedTeams)] })).toBe(false);
});
