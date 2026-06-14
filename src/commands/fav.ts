import { c } from "../ansi.ts";
import { getFavorites, addFavorite, removeFavorite } from "../config.ts";

// `sportsing fifa fav [add|rm|list] [team]` — manage favorite teams.
// Team names are free-text (e.g. "USA", "Brazil") matched case-insensitively
// elsewhere; multi-word names work unquoted ("fav add South Korea").
export async function fav(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const team = rest.join(" ").trim();

  if (!sub || sub === "list") {
    printList(await getFavorites());
    return;
  }

  if (sub === "add") {
    if (!team) return usage("fav add <team>");
    const { added, favorites } = await addFavorite(team);
    console.log(added ? c.green(`★ Added ${team}.`) : c.yellow(`${team} is already a favorite.`));
    printList(favorites);
    return;
  }

  if (sub === "rm" || sub === "remove") {
    if (!team) return usage("fav rm <team>");
    const { removed, favorites } = await removeFavorite(team);
    console.log(removed ? c.green(`Removed ${team}.`) : c.yellow(`"${team}" wasn't in your favorites.`));
    printList(favorites);
    return;
  }

  usage("fav <add|rm|list> [team]");
}

function printList(favorites: string[]): void {
  if (favorites.length === 0) {
    console.log(c.dim("No favorite teams yet. Add one: ") + c.bold("sportsing fifa fav add USA"));
    return;
  }
  console.log(c.bold(c.cyan("★ Favorite teams")));
  for (const f of favorites) console.log("  " + f);
}

function usage(form: string): void {
  console.error(c.red(`Usage: sportsing fifa ${form}`));
  process.exitCode = 1;
}
