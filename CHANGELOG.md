# Changelog

## Unreleased

- Soccer teams are followed in every competition (AGT-2463). Before, a national team was only known through the World Cup feed and a club only through its domestic league, so a favorite's Nations League, qualifying, friendly, Champions League, Europa League and cup games never appeared and the daemon never opened them.
  - New `sportsing intl` namespace for national teams: `next`, `today`, `schedule`, `results`, `watch`, `teams`, `fav` (`--team <nation>`, else your `fifa` favorites). Works for any national team, not only World Cup ones.
  - Club leagues: `schedule`, `results`, `next` and `today` with `--team` or `--mine` include cups, Europe and friendlies, each labelled with its competition. League-wide views are unchanged.
  - Bare `today`, `next`, `me`, `live --notify`, `sportsing all` and the daemon include those games. A `fifa` favorite's entry merges its World Cup matches with its other games. `all --json` rows gain a `competition` field (the competition's name, or `null` for a league's own game).
  - `intl fav add` warns when the name isn't a national team it can follow (the favorite is still saved).
  - Where-to-watch: a league's assumed service is no longer applied to games in other competitions; FS2 routes to Fubo; Champions League and Europa League games open Paramount+'s page for that competition.
  - `watch` and `next --team` read where a game airs from its scoreboard, so soccer games no longer show "no broadcasts listed" when ESPN does list one.
  - The daemon no longer reports the World Cup feed's missing API key outside the tournament.

- Where-to-watch: NBCUniversal's channels have been off Fubo since 2025-11-21, so NBC, USA Network, Telemundo and Universo no longer route to Fubo. NBC now routes to Peacock (which streams it) or over the air, Telemundo over the air only, and USA Network/Universo show as not carried. ESPN's "Tele" label is shown as "Telemundo".

- Dependency pass (AGT-1774): `typescript` 6.0.3 to 7.0.2 (typecheck clean, no tsconfig or source changes); `actions/checkout` v5 to v7.0.1 and `actions/setup-node` v4 to v7.1.0 in the CI and publish workflows (still SHA-pinned; publish permissions, `id-token: write` and `registry-url` unchanged).
- Declined `@types/node` 25 to 26: Bun (the runtime, `engines.bun >=1.1.0`) emulates an older Node API surface than v26, so the newer types would advertise APIs the runtime lacks.

## 0.5.2 — 2026-10-11

- Bump `@openthink/ui-leaf` to `^1.7.0`. ui-leaf now resolves `closed` when Chrome exits or its last window closes (reason `"browser"`) and exits with its parent, so the CDP `/json/list` window watcher (`src/window-watch.ts`, AGT-1708) is removed along with the debug port that `spawnStreamWindow` forced on every window. The port is now only opened when a caller (overlay, deep-link) asks for it. (AGT-1763)
