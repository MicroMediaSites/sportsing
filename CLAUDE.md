# CLAUDE.md

Project-specific instructions for Claude Code (auto-loaded into the model's context).

<!-- stamp:begin (managed by `stamp init` — do not edit between markers) -->

## Stamp-protected repository — read AGENTS.md before any git operation

This repository is gated by [stamp-cli](https://github.com/OpenThinkAi/stamp-cli).
**Do not `git commit` directly to protected branches** (typically `main`)
**and do not `git push origin main`** of any commit you didn't produce via
`stamp merge`. The required flow is:

```sh
git checkout -b feature
# ... edit, commit on the feature branch ...
stamp review --diff main..feature       # all reviewers run in parallel
stamp status --diff main..feature       # gate check (exit 0 = open)
git checkout main
stamp merge feature --into main         # signs the merge
git push origin main                    # OR `stamp push main` if origin is a stamp server
```

Key commands: `stamp provision` — provision a new repo; `stamp review` — run reviewers; `stamp merge` — sign a merge; `stamp push` — push to a stamp server.

**The full reference is at [`AGENTS.md`](./AGENTS.md) at the repo root** —
read it before any git command. It covers the mode (server-gated vs.
local-only), what NOT to do, where things live, and how to recover when stamp
blocks you.

**One exception:** the very first commit that ADDS `.stamp/` + `AGENTS.md` +
`CLAUDE.md` to a fresh repo is allowed to land directly on the current branch
(there's nothing to review against). Recent `stamp init` runs do this commit
automatically. Every subsequent change goes through the stamp flow.

<!-- stamp:end -->

## Smoke-testing: never block on GUI / interactive commands

`watch` (and `watch --overlay`) open a browser window and **block until you close
it or Ctrl-C** — there is no natural exit. A build/verify agent that "smoke-tests
by running the binary" (e.g. the `sportsing-build` Phase-3 step, or any run/verify
skill) will **hang forever** on `watch`, holding a Chrome + ~15-process ui-leaf
tree open. (That — not a teardown leak — was the source of the "orphan processes"
diagnosed 2026-06-13; SIGTERM / closing the window reaps the tree cleanly.)

When smoke-testing changes, **do not run `watch` / `watch --overlay` blockingly:**

- Use the bounded path: **`sportsing fifa watch --smoke [--provider …]`** — it
  opens the window, confirms it came up over CDP, tears it down, and exits 0
  (exit 1 if it didn't). This is the way to exercise the launch path in a script.
- `watch` with **no controlling TTY** now refuses (exits 1) instead of hanging, so
  `sportsing fifa watch <team> < /dev/null` is safe — but prefer `--smoke` to
  actually test the launch.
- Otherwise just rely on `bun run typecheck` + `bun run build` + the command's
  `--help`/usage output; don't launch the GUI at all.
- Any other long-running/GUI command: wrap in a bounded `timeout` (or background +
  kill) and confirm no surviving processes afterward.

`watch --supervised` is **not** a smoke-test path — it's the opposite: it lets the
`/loop agent-setup` supervisor run `watch --wait` headless (no TTY) on purpose,
blocking until the game opens, and reaps it via the pidfile. Don't use it to
"smoke-test" — it will block. For tests use `--smoke`.
