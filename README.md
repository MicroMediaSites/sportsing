# ⚽ sportsball

Sports in your terminal — the FIFA World Cup 2026 schedule, favorites, live
scores, **ambient fav-alerts**, browser streaming, highlights, stats, and AI
analysis. Zero runtime dependencies; built on [Bun](https://bun.sh).

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
| `watch [team] [--wait] [--overlay] [--provider] [--url]` | Open the broadcast in your own browser |
| `highlights <team>` | Open a highlights search |
| `fixtures` / `schedule` / `results` | Fixtures, whole-tournament schedule, finished games (`--mine`) |
| `table [A-L]` / `bracket` | Group standings / knockout bracket |
| `teams` / `scorers` / `stats <team>` | Teams, Golden Boot race, match stats (`--json`) |
| `analyze` / `predict <team>` | AI tactical read / prediction |
| `fav [add\|rm\|list]` / `me` | Manage favorite teams / your dashboard |
| `setup [key]` | Add your football-data.org API key |

Run `sportsball fifa help` for the full list.

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
  Only meaningful together with `--notify`. `Ctrl-C` stops it.

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
agent over a file bus. To use "Ask Claude" while watching, run the serve loop
alongside the stream:

```sh
sportsball fifa watch --wait    # (backgrounded) opens the game when it's live
/loop sportsball serve          # answers Ask questions + analyze/predict
```

## Development

This is a stamp-governed repo — read [`AGENTS.md`](./AGENTS.md) before any git
operation. Changes flow through `stamp review` → gate → `stamp merge`, never a
direct push to `main`.

```sh
bun run typecheck
bun test
bun run build
```
