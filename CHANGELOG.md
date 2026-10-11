# Changelog

## 0.5.2 — 2026-10-11

- Bump `@openthink/ui-leaf` to `^1.7.0`. ui-leaf now resolves `closed` when Chrome exits or its last window closes (reason `"browser"`) and exits with its parent, so the CDP `/json/list` window watcher (`src/window-watch.ts`, AGT-1708) is removed along with the debug port that `spawnStreamWindow` forced on every window. The port is now only opened when a caller (overlay, deep-link) asks for it. (AGT-1763)
