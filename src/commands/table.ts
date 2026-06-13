import { c } from "../ansi.ts";
import { getStandings, NoKeyError } from "../api.ts";
import { standingsTable, groupName } from "../format.ts";

export async function table(args: string[]) {
  const filter = args.find((a) => !a.startsWith("--"))?.toUpperCase() ?? null;

  let standings;
  try {
    standings = (await getStandings()).standings;
  } catch (e) {
    if (e instanceof NoKeyError) {
      console.error(
        c.yellow("Group tables need live data. Run `sportsball setup` to add a free API key."),
      );
      return;
    }
    throw e;
  }

  const groups = standings.filter((s) => s.type === "TOTAL" && s.group);

  if (groups.length === 0) {
    console.log(
      c.dim(
        "No standings yet — the group stage hasn't produced results. Check back after kickoff (Jun 11).",
      ),
    );
    return;
  }

  console.log(c.bold(c.cyan("⚽ World Cup 2026 — Group Standings")));
  console.log(c.dim("Green = advancing (top 2 per group)\n"));

  const wanted = groups.filter((g) => {
    if (!filter) return true;
    const letter = g.group?.replace("GROUP_", "");
    return letter === filter || groupName(g.group).toUpperCase().includes(filter);
  });

  if (wanted.length === 0) {
    console.log(c.yellow(`No group "${filter}". Groups run A–L.`));
    return;
  }

  console.log(wanted.map((g) => standingsTable(g.group, g.table)).join("\n\n"));
}
