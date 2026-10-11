# Changelog

## Unreleased

- Dependency pass (AGT-1774): `typescript` 6.0.3 to 7.0.2 (typecheck clean, no tsconfig or source changes); `actions/checkout` v5 to v7.0.1 and `actions/setup-node` v4 to v7.1.0 in the CI and publish workflows (still SHA-pinned; publish permissions, `id-token: write` and `registry-url` unchanged).
- Declined `@types/node` 25 to 26: Bun (the runtime, `engines.bun >=1.1.0`) emulates an older Node API surface than v26, so the newer types would advertise APIs the runtime lacks.

## 0.5.2 — 2026-10-11

- Bump `@openthink/ui-leaf` to `^1.7.0`. ui-leaf now resolves `closed` when Chrome exits or its last window closes (reason `"browser"`) and exits with its parent, so the CDP `/json/list` window watcher (`src/window-watch.ts`, AGT-1708) is removed along with the debug port that `spawnStreamWindow` forced on every window. The port is now only opened when a caller (overlay, deep-link) asks for it. (AGT-1763)
