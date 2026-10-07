# ⚽ sportsing

Sports in your terminal — the FIFA World Cup 2026, the **NBA**, and the
**NHL**: schedules, favorites across every sport, live scores, standings, playoff
brackets, **where to watch**, **ambient fav-alerts**, browser streaming,
highlights, stats, and AI analysis. Runs on [Bun](https://bun.sh); its one runtime dependency,
[ui-leaf](https://www.npmjs.com/package/@openthink/ui-leaf), powers the
browser-streaming window and is installed (with its native binary) automatically.

```
sportsing fifa today
sportsing nba schedule --team UTAH
sportsing nhl next --team UTAH
sportsing today              # your favorite teams across every sport (fifa, nba, nhl)
```

> **Upgrading from 0.1.x?** Bare commands other than `today` / `next` / `me` now
> need a sport prefix (`sportsing serve` → `sportsing fifa serve`), and favorites
> are now stored per sport. See **Upgrading to 0.2.0** below.

## Install

From npm (needs [Bun](https://bun.sh) on your `PATH` — the CLI runs on it):

```sh
bun install -g sportsing     # or: npm install -g sportsing
sportsing --version
```

To update later, run `sportsing upgrade`. It checks npm for the latest release
and reinstalls it with whichever of npm or bun installed your copy.
`sportsing upgrade --check` only compares your version with the latest and
installs nothing. A source checkout, a compiled binary or an `npx`/`bunx`
run isn't updated in place. For those, the command prints how to update
instead.

From source:

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

`sportsing fifa <command>` (bare `sportsing today|next|me` cover your favorites
across every sport — see **Your teams, every sport** below):

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

## NBA

`sportsing nba <command>` — the NBA via ESPN's free API (no key), preseason
through playoffs. Times are local; preseason games are tagged `PRE`, postseason
(incl. play-in) `POST`.

| Command | What it does |
|---|---|
| `today [--tomorrow\|--yesterday\|--offset N]` | One day's games |
| `next` | Next game + countdown |
| `schedule` | A team's whole season by day (league-wide: next 7 days) |
| `results` | Finished games, newest first (league-wide: last 7 days) |
| `standings [--conference X] [--division X]` | Regular-season standings, favorites marked ★ |
| `season [team]` | Your favorites' season: record, home/away splits, playoff race |
| `bracket [--season YYYY]` | Playoff bracket (projected before the postseason) |
| `fav [add\|rm\|list]` | Manage NBA favorites (`fav add UTAH`, `fav add Jazz`) |
| `watch [team] [--wait] [--provider X] [--url L] [--smoke] [--supervised]` | Open the game where you can watch it — see **Where to watch** below |
| `live [--notify [--quiet]]` | Auto-refreshing live board; `--notify` alerts for favorites — see **Live fav-alerts** below |
| `analyze <team> [team]` | AI read of the live or latest game: shooting, boards, turnovers, leaders (answered by `serve`; `--prompt` prints it) |
| `predict <team> [team]` | AI prediction for the next game from both teams' recent form |
| `recap <team> [team]` | AI "here's what you missed": lead changes, runs, close-late baskets, quarter scores |

`--team X` (abbreviation or name; NBA.com codes like `UTA` work too) picks one
team for `today` / `next` / `schedule` / `results`; `--mine` limits them to your
NBA favorites. NBA favorites are separate from FIFA ones.

`today` / `next` / `schedule` show a **WATCH** column once you've set your
subscriptions (see **Where to watch**). `sportsing nba watch` opens Jazz games on
Fubo by default.

`sportsing nba watch [team] --overlay` opens Fubo's NBA hub with a live-stats
overlay (same gear / settings / spoiler-delay as the FIFA one) that follows the
game you open, recognized from the page title's English team names. NBA panels:
score & clock, FG% / 3P%, leaders (PTS / REB / AST), fouls, timeouts. On an NHL
game page (`sportsing nhl watch --provider fubo --overlay`): score & clock,
shots on goal, power plays, faceoff %, goalie saves. Both have **Get caught up**
(a recap up to your delayed stream's moment, via `/loop sportsing serve`). Panel choices are saved per
provider and sport (`overlayPanels["fubo:nba"]`). `--overlay --smoke` checks the
overlay renders, then tears the window down.

## NHL

`sportsing nhl <command>` — the same commands as `nba`, for the NHL (ESPN, no
key), preseason through playoffs, tagged `PRE` / `POST` the same way. Live and
final status uses hockey periods: `12:34 - 2nd`, `End of 3rd`, `OT`, `SO`,
`Final/OT`, `Final/SO`.

`--team X` takes an abbreviation or name — `UTAH`, `UTA`, `Mammoth`, and
NHL.com codes like `TBL` / `LAK` all work. NHL favorites (`fav add UTAH`) are
separate from NBA and FIFA ones, so the Jazz and the Mammoth can both be `UTAH`.

`standings`, `season`, `bracket`, `watch`, and `analyze` / `predict` / `recap`
work exactly as for the NBA — the AI prompts speak hockey (goaltending, special
teams, every goal and penalty). There's
no default NHL streaming provider: `nhl watch` follows **Where to watch** — a
Mammoth game on Utah 16 opens Fubo (which carries Utah 16 in-market) with the
`fubo` subscription, or prints the channel to tune in with only `local-ota`.

## Where to watch (NBA / NHL)

Tell sportsing what you can watch with and where you live, once — it applies to
every sport:

```sh
sportsing subscriptions set fubo nba-league-pass local-ota   # whichever you have (or `none`)
sportsing subscriptions market utah                          # home market (default: utah)
sportsing subscriptions                                      # show them (alias: subs)
```

From each game's broadcasts (ESPN), sportsing then works out how *you* can watch
it:

- **WATCH column** in `today` / `next` / `schedule`: the service (`Fubo`,
  `NBA League Pass`) or over-the-air channel, `✗` if you can't watch it, `?` if it
  can't tell. With no subscriptions set, a one-line hint replaces the column.
- **`<sport> watch`** acts on the same answer: opens Fubo or League Pass, prints
  the channel for an over-the-air-only game (nothing to open; exits 0), or says
  why a game isn't watchable (exits 1). `--provider` / `--url` override it.
- **League Pass** covers out-of-market NBA games only — blacked out when a
  home-market team plays or the game has a national broadcast. National
  exclusives you don't carry are flagged.

## Your teams, every sport

Bare `today`, `next`, and `me` (no sport prefix) aggregate your favorite teams
across every sport, each row tagged with its sport:

```sh
sportsing nba fav add UTAH && sportsing nhl fav add UTAH
sportsing today      # the Jazz and the Mammoth today (--tomorrow, --yesterday, --offset N)
sportsing next       # each favorite's next game + countdown, soonest first
sportsing me         # last result + next game per favorite team
```

Bare `live --notify` alerts across every sport too (see **Live fav-alerts**),
and `sportsing daemon` opens your teams' games when they start (see **Daemon**).
Every other command needs a sport — a bare one (e.g. `sportsing standings`)
prints the sports that have it and exits non-zero.

Favorites are stored per sport as `<sport>:<team>` (`nba:UTAH`, `nhl:UTAH`,
`fifa:USA`) in `~/.config/sportsing/config.json`; add and remove them with each
sport's `fav` command.

## Daemon — open your teams' games automatically

`sportsing daemon` is an always-on watcher (a per-user launchd agent on macOS):
it polls every sport you have a favorite in and, when a favorite's game starts,
does what `<sport> watch` would — Fubo / League Pass **opens the game window**;
an over-the-air-only game gets a notification naming the channel; an
unwatchable one gets a notification saying why. It's set up once and survives
logins and `sportsing upgrade`.

```sh
sportsing daemon install       # write + load ~/Library/LaunchAgents/com.sportsing.daemon.plist
sportsing daemon status        # is it running, what it's waiting for, what it last did
sportsing daemon logs [-f]     # its log (~/Library/Logs/sportsing/daemon.log)
sportsing daemon mode notify   # notify (click to watch) instead of auto-opening; `open` is the default
sportsing daemon uninstall     # stop + remove it
```

- **Status at a glance.** Bare `today` / `next` / `me` end with a one-line
  footer — `daemon: on — waiting for DEN @ UTAH 7:00 PM`, `daemon: off —
  sportsing daemon install`, or `daemon: stuck — last poll 47m ago`.
  `daemon status` shows installed / pid + uptime / last poll / next game and
  where it'll open / last game acted on, flags **STUCK** when the last poll is
  older than ~3 poll intervals, and exits 0 only when it's running and healthy
  (scriptable).
- **Each game is acted on once** (remembered in
  `~/.cache/sportsing/daemon-state.json`): close the window and it stays closed;
  a crash or restart doesn't open it twice. A game already under way that it
  hasn't acted on yet (say the Mac woke mid-game) is opened then.
- **Polling** is sparse (every 10 min) until 15 minutes before a favorite's
  scheduled start, then every 30s until it goes live — including a delayed
  start (up to 3h late).
- **One sport failing** (e.g. FIFA without an API key) shows as a warning in
  `status`; the others keep working.
- **Install from a global install** (`npm install -g sportsing` or
  `bun add -g sportsing`): the agent runs that install's stable `sportsing`
  bin, and `sportsing upgrade` restarts it on the new version. Preview the
  plist without installing: `sportsing daemon install --dry-run`.
- The daemon opens the window as a detached `sportsing <sport> watch <team>
  --supervised` (no terminal needed; closing the window ends it). Set up where
  you watch first (`sportsing subscriptions set …`, see **Where to watch**).

## Upgrading to 0.2.0

- **Breaking — bare commands need a sport.** In 0.1.x every bare command ran as a
  FIFA command (`sportsing serve` meant `sportsing fifa serve`). Now only `today`,
  `next`, and `me` work bare (across every sport); everything else needs its
  prefix: `sportsing fifa serve`, `sportsing fifa live --notify`,
  `sportsing fifa watch USA`, `sportsing fifa fav add USA`, and so on. Update any
  scripts, aliases, or launchd jobs that call a bare command.
- **Favorites are scoped by sport.** Existing unprefixed favorites (`"USA"`) are
  read as FIFA favorites (`fifa:USA`) — nothing is lost. The file is rewritten in
  the prefixed form the next time you add or remove a favorite. Downgrading to
  0.1.x after that would see `fifa:USA` as a team name, so don't mix versions.

## Watch (FIFA)

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
sportsing nba live --notify                # same for the NBA (and `nhl live`)
sportsing live --notify --quiet &          # one alerter for every sport with a favorite
```

Each refresh diffs the latest scores against the previous tick and raises an OS
notification for every **new** favorite-team event — so each kickoff, goal, and
full-time alerts exactly once:

- **Kickoff** — *click the notification to start watching* (launches
  `sportsing fifa watch <team>` for that match).
- **Goal** — the scorer and the resulting scoreline (with a sound).
- **Full time** — the final scoreline.

NBA and NHL alert on what matters per sport, not every basket:

- **NHL** — puck drop, every goal (with a sound), end of each period, overtime /
  shootout, final.
- **NBA** — tip-off, lead changes, a close finish (≤ 5 points with ≤ 5:00 left in
  the 4th or OT, once per game), final.
- **Tip-off / puck drop** are click-to-watch, routed like `<sport> watch` (see
  **Where to watch**): a game on Fubo or League Pass opens on click; an
  over-the-air-only game names its channel instead (nothing to click into).

Bare `sportsing live --notify` polls every sport you have a favorite in from one
process; a sport that can't load (e.g. FIFA without an API key) is reported and
the rest keep alerting. Without `--quiet` it logs each alert as a line.

Flags:

- **`--notify`** — fire the alerts. With no favorites set, it warns and runs the
  board normally. Without it, `live` behaves exactly as before.
- **`--quiet`** — suppress the full-screen scoreboard so the command can be
  backgrounded (`&`) as a pure ambient alerter without redrawing your terminal.
  Only meaningful together with `--notify` — used alone it prints a hint and
  exits. `Ctrl-C` stops it.

### Click-to-watch requires `terminal-notifier`

Clickable kickoff / tip-off / puck-drop notifications use
[`terminal-notifier`](https://github.com/julienXX/terminal-notifier) (macOS):

```sh
brew install terminal-notifier
```

Notifications **degrade gracefully** when it's absent: on macOS they fall back to
`osascript` (plain banner, no click action); on Linux to `notify-send`; otherwise
to a terminal bell. Nothing errors — you just don't get the one-click-to-watch
behavior without `terminal-notifier`. A click opens a Terminal window running
`watch` (Ctrl-C or close the stream window to stop).

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

> **NBA / NHL:** just to have your team's games open when they start, you don't
> need this loop — use **`sportsing daemon install`** (see **Daemon**). It runs
> without a Claude session and works across every sport with a favorite.
> `/loop agent-setup` is for the FIFA overlay's Ask Claude / Get caught up.

> **The cost, honestly:** the loop consumes that Claude session as the always-on
> answerer for as long as it runs — that's the trade you're choosing. Stop the loop
> and the heartbeat goes stale within ~90s, so the panels return to "○ No agent".
> Run it in a minimal-tool session (it answers untrusted viewer text).

### Low-level primitive — `serve`

`sportsing fifa serve` is the bare answerer loop (it powers `analyze` / `predict`
/ `recap` too — for every sport: the bus is shared, so one `fifa serve` answers
NBA and NHL questions as well). `agent-setup` supersedes the old manual two-step for the agent-driven flow,
but `serve` remains the primitive if you want to compose it yourself:

```sh
sportsing fifa watch --wait    # (backgrounded) opens the game when it's live
/loop sportsing fifa serve     # answer-only loop — no watch supervision
```

> **Run the answerer in a minimal-tool session.** Whether via `agent-setup` or
> `serve`, the loop reads **untrusted** text (viewer questions + raw API fields)
> into a tool-capable Claude session. Give that session no MCP/file tools and only
> the `sportsing fifa ask --reply` Bash capability, so a prompt-injection in a question
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
