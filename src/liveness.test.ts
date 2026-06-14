import { test, expect } from "bun:test";
import { pidAlive, WATCH_PIDFILE } from "./liveness.ts";

test("pidAlive: the current process is alive", () => {
  expect(pidAlive(process.pid)).toBe(true);
});

test("pidAlive: a non-existent PID is not alive (stale-pidfile detection)", () => {
  // 0x7fffffff is far above any real PID on macOS/Linux → no such process.
  expect(pidAlive(2147483646)).toBe(false);
});

test("pidAlive: invalid PIDs (<=0, non-integer) are not alive", () => {
  expect(pidAlive(0)).toBe(false);
  expect(pidAlive(-1)).toBe(false);
  expect(pidAlive(NaN)).toBe(false);
  expect(pidAlive(3.5)).toBe(false);
});

test("WATCH_PIDFILE is a stable, locatable path under the cache dir", () => {
  expect(WATCH_PIDFILE).toContain("sportsing");
  expect(WATCH_PIDFILE.endsWith("watch-wait.pid")).toBe(true);
});
