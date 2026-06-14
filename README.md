# ⚽ sportsing

Sports in your terminal — the FIFA World Cup 2026 schedule, favorites, live
scores, **ambient fav-alerts**, browser streaming, highlights, stats, and AI
analysis. Runs on [Bun](https://bun.sh); its one runtime dependency,
[ui-leaf](https://www.npmjs.com/package/@openthink/ui-leaf), powers the
browser-streaming window and is installed (with its native binary) automatically.

```
sportsing fifa today
sportsing fifa next --team USA
sportsing today              # the `fifa` prefix is optional during the World Cup
```

## Install

```sh
bun install                 # deps: ui-leaf (+ its browser binary) and dev types
bun run build               # compiles a standalone binary → dist/sportsing
```

Then run `./dist/sportsing …`, or put it on your `PATH`.

> **Streaming from the compiled binary.** `bun run build` produces a single
> file, but it can't embed ui-leaf's ~64MB native browser binary. Running from
> source (`bun run src/index.ts …`) or installing from npm resolves that binary
> automatically; for the standalone `dist/sportsing`, point streaming at an
> installed copy with `UI_LEAF_BINARY_PATH=/path/to/ui-leaf-bin`. Everything
> except the `watch` browser window works with no binary present.

For live data, add a free [football-data.org](https://www.football-data.org) API key:

```sh
sportsing fifa setup       # paste your key (or set FOOTBALL_DATA_API_KEY)
```

Without a key, fixtures fall back to the offline openfootball schedule (no live
scores or tables).

## Commands

`sportsing fifa <command>` (or just `sportsing <command>` during the Cup):

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

Run `sportsing fifa help` for the full list (`serve` and `ask` are the AI-bus
commands; `ask` is low-level plumbing that `serve` wraps).

## Watch

`sportsing fifa watch [team] [team]` opens the broadcast in your own browser
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

- **`--smoke`** — open the window, confirm it came up, tear it down, exit 0. For
  scripts/CI. `watch` is otherwise **interactive** — it blocks until you close the
  window — so run without a controlling TTY (e.g. `< /dev/null`) it refuses rather
  than hanging. Use `--smoke` to verify the launch path instead.
- **`--supervised`** — opt into running headless (no TTY) without that refusal, for
  a pidfile-managed background watcher. This is what `/loop agent-setup` uses to
  keep `watch --wait` alive; it still blocks (it's reaped via the pidfile), so it's
  not a smoke-test — use `--smoke` for that.

> **A note on how the overlay attaches.** When `watch` needs to inject the stats
> overlay it launches Chrome with a DevTools remote-debugging port and drives the
> page over CDP. That port is bound to **loopback (127.0.0.1) only** and used just
> long enough to inject the overlay, but while the window is open any *local*
> process could in principle attach to it. This is the same posture as any
> CDP-automation tool; it's only a concern on a shared/multi-user machine.

For a hands-off, agent-driven session — open the game **and** keep "Ask Claude" /
"Get caught up" answered — use **`/loop agent-setup`** instead of running `watch`
yourself (see the **AI** section below).

## Live fav-alerts

Turn `live` into an ambient alerter that pings you when your favorite teams play:

```sh
sportsing fifa fav add USA                 # set up favorites first
sportsing fifa live --notify               # live board + OS notifications
sportsing fifa live --notify --quiet &     # headless: alerts only, backgroundable
```

Each refresh diffs the latest scores against the previous tick and raises an OS
notification for every **new** favorite-team event — so each kickoff, goal, and
full-time alerts exactly once:

- **Kickoff** — *click the notification to start watching* (launches
  `sportsing fifa watch <team>` for that match).
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

## AI (analyze / predict / overlay "Ask Claude" + "Get caught up")

sportsing never spawns a local model. AI features route to an **external** Claude
agent over a file bus — opening a game is **not** enough; something must be serving
the bus or the overlay's Ask Claude / Get caught up panels show "○ No agent".

### Agent-driven watch session — `/loop agent-setup` (the blessed setup)

In a Claude session, drop in:

```
/loop agent-setup [team]
```

One supervisor loop that **is** the whole setup: it opens your game and keeps that
`watch --wait` window alive (relaunching it if it dies), and it serves the bus so
**Ask Claude** and **Get caught up** (catchup) are actually answered — by that
Claude session itself (no local model is ever spawned). `sportsing fifa agent-setup`
prints this recipe; `sportsing fifa` and the watch nag point at it.

> **The cost, honestly:** the loop consumes that Claude session as the always-on
> answerer for as long as it runs — that's the trade you're choosing. Stop the loop
> and the heartbeat goes stale within ~90s, so the panels return to "○ No agent".
> Run it in a minimal-tool session (it answers untrusted viewer text).

### Low-level primitive — `serve`

`sportsing fifa serve` is the bare answerer loop (it powers `analyze` / `predict`
too). `agent-setup` supersedes the old manual two-step for the agent-driven flow,
but `serve` remains the primitive if you want to compose it yourself:

```sh
sportsing fifa watch --wait    # (backgrounded) opens the game when it's live
/loop sportsing serve          # answer-only loop — no watch supervision
```

> **Run the answerer in a minimal-tool session.** Whether via `agent-setup` or
> `serve`, the loop reads **untrusted** text (viewer questions + raw API fields)
> into a tool-capable Claude session. Give that session no MCP/file tools and only
> the `sportsing ask --reply` Bash capability, so a prompt-injection in a question
> can't reach anything dangerous. `serve` prints this reminder each tick.

## Development

This is a stamp-governed repo — read [`AGENTS.md`](./AGENTS.md) before any git
operation. Changes flow through `stamp review` → gate → `stamp merge`, never a
direct push to `main`.

```sh
bun run typecheck
bun test
bun run build
```
