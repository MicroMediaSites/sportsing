import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtDate, KNOCKOUT_ORDER, STAGE_LABELS, heading } from "../format.ts";
import { withFallback, sortByDate } from "./_lib.ts";
import type { Match, Stage } from "../types.ts";

export async function bracket() {
  const matches = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const knockout = matches.filter((m) => m.stage !== "GROUP_STAGE");

  console.log(c.bold(c.cyan("⚽ World Cup 2026 — Knockout Bracket")));

  if (knockout.length === 0) {
    console.log(
      c.dim(
        "\nKnockout fixtures aren't set yet — they're determined once the group stage finishes.\n" +
          "The new 2026 format: 12 groups of 4 → Round of 32 → 16 → QF → SF → Final.",
      ),
    );
    return;
  }

  const byStage = new Map<Stage, Match[]>();
  for (const m of knockout) {
    (byStage.get(m.stage) ?? byStage.set(m.stage, []).get(m.stage)!).push(m);
  }

  for (const stage of KNOCKOUT_ORDER) {
    const ms = byStage.get(stage);
    if (!ms || ms.length === 0) continue;
    console.log(heading(`${STAGE_LABELS[stage]}  ${c.dim(`(${ms.length})`)}`));
    for (const m of ms.sort(sortByDate)) {
      const decided = m.status === "FINISHED";
      const prefix = stage === "FINAL" ? c.yellow("★ ") : decided ? c.green("✓ ") : c.dim("· ");
      console.log(`  ${prefix}${matchLine(m)}  ${c.dim(fmtDate(m.utcDate))}`);
    }
  }

  // Highlight the champion if the final is decided.
  const final = byStage.get("FINAL")?.[0];
  if (final?.status === "FINISHED") {
    const champ =
      final.score.winner === "HOME_TEAM"
        ? final.homeTeam.name
        : final.score.winner === "AWAY_TEAM"
          ? final.awayTeam.name
          : null;
    if (champ) {
      console.log("\n" + c.bgGreen(c.bold(` 🏆  WORLD CHAMPIONS: ${champ}  `)));
    }
  }
}
