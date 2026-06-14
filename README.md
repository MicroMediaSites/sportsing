# ⚽ sportsball

Sports in your terminal — the FIFA World Cup 2026 schedule, favorites, live
scores, **ambient fav-alerts**, browser streaming, highlights, stats, and AI
analysis. No npm dependencies; ships as a self-contained [Bun](https://bun.sh)
binary.

```
sportsball fifa today
sportsball fifa next --team USA
sportsball today              # the `fifa` prefix is optional during the World Cup
```

## Install

```sh
bun install                 # dev deps (TypeScript, types)
bun run build               # compiles a standalone binary → dist/sportsball
```

Then run `./dist/sportsball …`, or put it on your `PATH`. For live data, add a
free [football-data.org](https://www.football-data.org) API key:

```sh
sportsball fifa setup       # paste your key (or set FOOTBALL_DATA_API_KEY)
```

Without a key, fixtures fall back to the offline openfootball schedule (no live
scores or tables).

## Commands

`sportsball fifa <command>` (or just `sportsball <command>` during the Cup):

| Command | What it does |
|---|---|
| `today` / `next` | Today's matches / next upcoming match + countdown |
| `live [--notify [--quiet]]` | Auto-refreshing live scoreboard — see **Live fav-alerts** below |
| `watch [team] [flags]` | Open the broadcast in your own browser — see **Watch** below |
| `highlights <team>` | Open a highlights search |
| `fixtures` / `schedule` / `results` | Fixtures, whole-tournament schedule, finished games (`--mine`) |
| `table [A-L]` / `bracket` | Group standings / knockout bracket |
| `teams` / `scorers` / `stats <team>` | Teams, Golden Boot race, match stats (`--json`) |
| `analyze` / `predict <team>` | AI tactical read / prediction (answered by `serve`) |
| `serve` | Run the AI answer loop that powers `analyze`, `predict`, and the overlay's "Ask Claude" (see **AI** below) |
| `fav [add\|rm\|list]` / `me` | Manage favorite teams / your dashboard |
| `setup [key]` | Add your football-data.org API key |

Run `sportsball fifa help` for the full list (`serve` and `ask` are the AI-bus
commands; `ask` is low-level plumbing that `serve` wraps).

## Watch

`sportsball fifa watch [team] [team]` opens the broadcast in your own browser
(your real Chrome, via [ui-leaf](https://www.npmjs.com/package/@openthink/ui-leaf)):

- **`--wait`** — block until the match goes live, then open it (deep-linked to the
  game with the stats overlay). With no team, waits for the *next* match overall.
- **`--overlay`** — inject the live-stats panel onto the page (needs a resolved
  match; `--wait` always opens with it).
- **`--provider peacock|fubo`** — override the configured default (Fubo by default;
  Peacock is Spanish/Telemundo).
- **`--url <link>`** — jump straight to a specific game link, skipping the hub.
- **`--lang english|spanish`** — preferred broadcast language (default `english`),
  for providers that carry both airings (Fubo = Fox/English + Telemundo/Spanish;
  Peacock is Spanish-only). The flag is accepted and carried now; the
  language-biased deep-link selection is not wired yet (a notice prints when a
  non-default language is requested).

## Live fav-alerts

Turn `live` into an ambient alerter that pings you when your favorite teams play:

```sh
sportsball fifa fav add USA                 # set up favorites first
sportsball fifa live --notify               # live board + OS notifications
sportsball fifa live --notify --quiet &     # headless: alerts only, backgroundable
```

Each refresh diffs the latest scores against the previous tick and raises an OS
notification for every **new** favorite-team event — so each kickoff, goal, and
full-time alerts exactly once:

- **Kickoff** — *click the notification to start watching* (launches
  `sportsball fifa watch <team>` for that match).
- **Goal** — the scorer and the resulting scoreline (with a sound).
- **Full time** — the final scoreline.

Flags:

- **`--notify`** — fire the alerts. With no favorites set, it warns and runs the
  board normally. Without it, `live` behaves exactly as before.
- **`--quiet`** — suppress the full-screen scoreboard so the command can be
  backgrounded (`&`) as a pure ambient alerter without redrawing your terminal.
  Only meaningful together with `--notify` — used alone it prints a hint and
  exits. `Ctrl-C` stops it.

### Click-to-watch requires `terminal-notifier`

Clickable kickoff notifications use
[`terminal-notifier`](https://github.com/julienXX/terminal-notifier) (macOS):

```sh
brew install terminal-notifier
```

Notifications **degrade gracefully** when it's absent: on macOS they fall back to
`osascript` (plain banner, no click action); on Linux to `notify-send`; otherwise
to a terminal bell. Nothing errors — you just don't get the one-click-to-watch
behavior without `terminal-notifier`.

## AI (analyze / predict / overlay "Ask Claude")

sportsball never spawns a local model. AI features route to an **external** Claude
agent over a file bus — `sportsball fifa serve` is the loop that picks up requests
and answers them. To use "Ask Claude" while watching, keep `serve` running
alongside the stream (it must stay alive to answer):

```sh
sportsball fifa watch --wait    # (backgrounded) opens the game when it's live
sportsball fifa serve           # in its own terminal — answers Ask / analyze / predict
```

> Inside Claude Code, `/loop sportsball serve` keeps the answer loop alive for
> you; outside it, just run `serve` in a dedicated terminal (or background it).

## Development

This is a stamp-governed repo — read [`AGENTS.md`](./AGENTS.md) before any git
operation. Changes flow through `stamp review` → gate → `stamp merge`, never a
direct push to `main`.

```sh
bun run typecheck
bun test
bun run build
```
