import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { groupName } from "../format.ts";
import { withFallback, getFlag } from "./_lib.ts";

// `sportsball fifa teams [--group A] [--json]` — the teams in the tournament,
// grouped by group. Derived from the fixture list (so it works with or without
// an API key), keyed by name; group + TLA filled in from group-stage matches.
interface TeamInfo {
  name: string;
  tla: string | null;
  group: string | null; // e.g. "GROUP_A"
}

export async function teams(args: string[]) {
  const json = args.includes("--json");
  const groupArg = getFlag(args, "--group"); // throws if --group has no value

  const matches = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const byName = new Map<string, TeamInfo>();
  for (const m of matches) {
    const g = m.stage === "GROUP_STAGE" ? m.group : null;
    for (const t of [m.homeTeam, m.awayTeam]) {
      if (!t.name) continue;
      const cur = byName.get(t.name) ?? { name: t.name, tla: null, group: null };
      if (!cur.tla && t.tla) cur.tla = t.tla;
      if (!cur.group && g) cur.group = g;
      byName.set(t.name, cur);
    }
  }

  let list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (groupArg) {
    const want = `GROUP_${groupArg.toUpperCase()}`;
    list = list.filter((t) => t.group === want);
    if (list.length === 0) {
      console.log(c.yellow(`No teams found in group ${groupArg.toUpperCase()}.`));
      return;
    }
  }

  if (json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  console.log(c.bold(c.cyan(`⚽ World Cup 2026 — Teams (${list.length})`)));

  const groups = new Map<string, TeamInfo[]>();
  for (const t of list) {
    const key = t.group ?? "ZZZ_unknown"; // sort unknowns last
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  for (const key of [...groups.keys()].sort()) {
    const label = key === "ZZZ_unknown" ? "Unknown group" : groupName(key);
    console.log("\n" + c.bold(label));
    for (const t of groups.get(key)!) {
      console.log("  " + t.name + (t.tla ? c.dim(` (${t.tla})`) : ""));
    }
  }
}
