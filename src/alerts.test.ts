import { test, expect } from "bun:test";
import { pollAlerters, type Alert, type Alerter } from "./alerts.ts";

const alert = (title: string): Alert => ({ title, body: "", options: {} });
const alerter = (label: string, poll: Alerter["poll"]): Alerter => ({ label, teams: [], poll });

test("pollAlerters: a failing sport is reported and skipped; the rest still alert, in order", async () => {
  const failed: string[] = [];
  const out = await pollAlerters(
    [
      alerter("NBA", async () => [alert("tip-off")]),
      alerter("FIFA", async () => {
        throw new Error("rate limited");
      }),
      alerter("NHL", async () => [alert("goal"), alert("final")]),
    ],
    (a, e) => failed.push(`${a.label}: ${(e as Error).message}`),
  );
  expect(out.map((a) => a.title)).toEqual(["tip-off", "goal", "final"]);
  expect(failed).toEqual(["FIFA: rate limited"]);
});
