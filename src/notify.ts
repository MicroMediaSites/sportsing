// Zero-dep OS-notification helper. Raises a desktop notification via the best
// available backend, optionally clickable to run a command, and degrades
// gracefully (terminal bell, never throws) where no notifier binary exists.
//
// Backend preference:
//   macOS   terminal-notifier (supports -execute on-click) → osascript (no click)
//   Linux   notify-send (no click)
//   any     terminal bell (\a) when nothing else is available
//
// Mirrors the Bun.which-guard pattern used for the `ui-leaf` CLI in
// src/stream.ts. Fire-and-forget: spawns the notifier without blocking and
// swallows spawn errors so a missing/odd binary never breaks a live tick.

export interface NotifyOptions {
  /** Smaller line shown under the title (macOS only). */
  subtitle?: string;
  /** Play a sound: `true` for the default, or a named system sound (e.g. "Ping"). macOS only. */
  sound?: boolean | string;
  /** Collapse repeated alerts: notifications sharing a group replace each other. macOS + terminal-notifier only. */
  group?: string;
  /** Shell command run when the notification is clicked. macOS + terminal-notifier only. */
  onClick?: string;
}

export type NotifyBackend = "terminal-notifier" | "osascript" | "notify-send" | "bell";

/**
 * Which notifier backend `notify` would use right now. On macOS, prefer
 * terminal-notifier (the only backend that supports `onClick` via -execute);
 * when it's absent, osascript still raises the notification but silently drops
 * any click action. Callers that need click support can check for the
 * "terminal-notifier" result before relying on `onClick`.
 */
export function notifierBackend(): NotifyBackend {
  if (process.platform === "darwin") {
    if (Bun.which("terminal-notifier")) return "terminal-notifier";
    if (Bun.which("osascript")) return "osascript";
  } else if (process.platform === "linux") {
    if (Bun.which("notify-send")) return "notify-send";
  }
  return "bell";
}

/** Escape a string for embedding in an AppleScript double-quoted literal. */
function osaEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function spawnQuiet(cmd: string[]): void {
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // A flaky/missing binary must never break the caller — fall through silently.
  }
}

/**
 * Raise a desktop notification. Returns the backend that handled it; "bell" means
 * no notifier binary was available and a terminal bell was emitted instead. Never throws.
 */
export function notify(title: string, body: string, opts: NotifyOptions = {}): NotifyBackend {
  const backend = notifierBackend();

  if (backend === "terminal-notifier") {
    const cmd = ["terminal-notifier", "-title", title, "-message", body];
    if (opts.subtitle) cmd.push("-subtitle", opts.subtitle);
    if (opts.group) cmd.push("-group", opts.group);
    if (opts.onClick) cmd.push("-execute", opts.onClick);
    if (opts.sound) cmd.push("-sound", opts.sound === true ? "default" : opts.sound);
    spawnQuiet(cmd);
    return backend;
  }

  if (backend === "osascript") {
    let script = `display notification "${osaEscape(body)}" with title "${osaEscape(title)}"`;
    if (opts.subtitle) script += ` subtitle "${osaEscape(opts.subtitle)}"`;
    if (opts.sound) script += ` sound name "${osaEscape(opts.sound === true ? "default" : opts.sound)}"`;
    spawnQuiet(["osascript", "-e", script]);
    return backend;
  }

  if (backend === "notify-send") {
    spawnQuiet(["notify-send", title, body]);
    return backend;
  }

  // Last resort: a terminal bell. Never throws.
  try {
    process.stderr.write("\x07");
  } catch {
    /* even the bell is best-effort */
  }
  return "bell";
}
