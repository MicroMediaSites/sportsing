import { describe, expect, test } from "bun:test";
import { fetchWithRetry, withRetry } from "./retry.ts";

function setup(responses: Array<Response | Error>) {
  let calls = 0;
  const delays: number[] = [];
  const fetchImpl = (async () => {
    const r = responses[calls++]!;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const opts = { fetchImpl, sleep: async (ms: number) => void delays.push(ms), jitter: () => 0 };
  return { opts, delays, calls: () => calls };
}
const res = (status: number, body = "{}") => new Response(body, { status });

describe("fetchWithRetry", () => {
  test("socket closed then success returns the success", async () => {
    const s = setup([new Error("The socket connection was closed unexpectedly"), res(200, '{"ok":1}')]);
    const r = await fetchWithRetry("http://x", undefined, s.opts);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: 1 });
    expect(s.calls()).toBe(2);
  });
  test("503, 503, 200 succeeds", async () => {
    const s = setup([res(503), res(503), res(200)]);
    expect((await fetchWithRetry("http://x", undefined, s.opts)).status).toBe(200);
    expect(s.calls()).toBe(3);
  });
  test("404 is not retried", async () => {
    const s = setup([res(404), res(200)]);
    expect((await fetchWithRetry("http://x", undefined, s.opts)).status).toBe(404);
    expect(s.calls()).toBe(1);
    expect(s.delays).toEqual([]);
  });
  test("429 is retried", async () => {
    const s = setup([res(429), res(200)]);
    expect((await fetchWithRetry("http://x", undefined, s.opts)).status).toBe(200);
    expect(s.calls()).toBe(2);
  });
  test("exhausting retries on a thrown error throws the last error", async () => {
    const s = setup([new Error("socket closed 1"), new Error("socket closed 2"), new Error("socket closed 3")]);
    await expect(fetchWithRetry("http://x", undefined, s.opts)).rejects.toThrow("socket closed 3");
    expect(s.calls()).toBe(3);
  });
  test("exhausting retries on 5xx returns the last response", async () => {
    const s = setup([res(500), res(502), res(503)]);
    expect((await fetchWithRetry("http://x", undefined, s.opts)).status).toBe(503);
    expect(s.calls()).toBe(3);
  });
  test("delays follow the 250/750 schedule, plus jitter", async () => {
    const s = setup([res(503), res(503), res(200)]);
    await fetchWithRetry("http://x", undefined, s.opts);
    expect(s.delays).toEqual([250, 750]);
    const j = setup([res(503), res(503), res(200)]);
    await fetchWithRetry("http://x", undefined, { ...j.opts, jitter: () => 5 });
    expect(j.delays).toEqual([255, 755]);
  });
  test("a timeout error is retried", async () => {
    const e = new Error("timed out");
    e.name = "TimeoutError";
    const s = setup([e, res(200)]);
    expect((await fetchWithRetry("http://x", undefined, s.opts)).status).toBe(200);
  });
});

describe("withRetry", () => {
  test("non-retryable error is thrown immediately", async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new Error("boom"); }, { isRetryable: () => false, sleep: async () => {} }),
    ).rejects.toThrow("boom");
    expect(n).toBe(1);
  });
});
