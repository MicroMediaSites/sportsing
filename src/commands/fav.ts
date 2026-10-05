import { c } from "../ansi.ts";
import { getFavorites, addFavorite, removeFavorite } from "../config.ts";

// `sportsing <sport> fav [add|rm|list] [team]` — manage a sport's favorite teams.
// Favorites are scoped per sport (stored `<sport>:<team>`), so `nba:UTAH` and
// `nhl:UTAH` coexist. Team names are free-text (e.g. "USA", "Brazil") matched
// case-insensitively elsewhere; multi-word names work unquoted ("fav add South Korea").
export async function fav(args: string[], sport: string): Promise<void> {
  const [sub, ...rest] = args;
  const team = rest.join(" ").trim();

  if (!sub || sub === "list") {
    printList(await getFavorites(sport), sport);
    return;
  }

  if (sub === "add") {
    if (!team) return usage(sport, "fav add <team>");
    const { added, favorites } = await addFavorite(sport, team);
    console.log(added ? c.green(`★ Added ${team}.`) : c.yellow(`${team} is already a favorite.`));
    printList(favorites, sport);
    return;
  }

  if (sub === "rm" || sub === "remove") {
    if (!team) return usage(sport, "fav rm <team>");
    const { removed, favorites } = await removeFavorite(sport, team);
    console.log(removed ? c.green(`Removed ${team}.`) : c.yellow(`"${team}" wasn't in your favorites.`));
    printList(favorites, sport);
    return;
  }

  usage(sport, "fav <add|rm|list> [team]");
}

/** Example team for the empty-list hint, per sport. */
const EXAMPLE_TEAM: Record<string, string> = { fifa: "USA", nba: "UTAH", nhl: "UTAH" };

function printList(favorites: string[], sport: string): void {
  if (favorites.length === 0) {
    const example = EXAMPLE_TEAM[sport] ?? "<team>";
    console.log(c.dim("No favorite teams yet. Add one: ") + c.bold(`sportsing ${sport} fav add ${example}`));
    return;
  }
  console.log(c.bold(c.cyan("★ Favorite teams")));
  for (const f of favorites) console.log("  " + f);
}

function usage(sport: string, form: string): void {
  console.error(c.red(`Usage: sportsing ${sport} ${form}`));
  process.exitCode = 1;
}
