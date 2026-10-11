import { test, expect } from "bun:test";
import { countPages, initialWatchState, stepWatch, watchWindow, type Observation } from "./window-watch.ts";

const run = (obs: [number, Observation][]) => {
  let s = initialWatchState();
  let gone = null as string | null;
  for (const [t, o] of obs) {
    const r = stepWatch(s, o, t);
    s = r.state;
    gone = r.gone ?? gone;
  }
  return gone;
};
const pages = (n: number): Observation => ({ kind: "pages", count: n });

test("countPages: only page targets", () => {
  expect(countPages([{ type: "page" }, { type: "service_worker" }, { type: "page" }, { type: "background_page" }])).toBe(2);
  expect(countPages(null)).toBe(0);
});

test("never gone before a page was seen", () => {
  expect(run([[0, pages(0)], [5000, pages(0)], [9000, { kind: "error" }], [9100, { kind: "error" }], [9200, { kind: "error" }]])).toBeNull();
});

test("a navigation blip (empty < debounce, then page back) is not closing", () => {
  expect(run([[0, pages(1)], [1000, pages(0)], [2000, pages(0)], [3000, pages(1)], [9000, pages(1)]])).toBeNull();
});

test("empty longer than the debounce = window closed", () => {
  expect(run([[0, pages(1)], [1000, pages(0)], [2000, pages(0)], [4000, pages(0)]])).toBe("window-closed");
});

test("empty timer restarts after pages return", () => {
  expect(run([[0, pages(1)], [1000, pages(0)], [2500, pages(1)], [3000, pages(0)], [5000, pages(0)]])).toBeNull();
});

test("endpoint dying after a page was seen = chrome quit; single errors are tolerated", () => {
  const e: Observation = { kind: "error" };
  expect(run([[0, pages(1)], [1000, e], [2000, pages(1)], [3000, e], [4000, e]])).toBeNull();
  expect(run([[0, pages(1)], [1000, e], [2000, e], [3000, e]])).toBe("chrome-quit");
});

test("watchWindow resolves chrome-quit when fetch starts failing", async () => {
  let n = 0;
  const fetchImpl = (async () => {
    if (n++ === 0) return { json: async () => [{ type: "page" }] };
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const w = watchWindow(1, { intervalMs: 5, fetchImpl });
  expect(await w.gone).toBe("chrome-quit");
});
