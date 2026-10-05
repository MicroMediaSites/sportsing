// Click-to-watch for start-of-game notifications: the shell command a
// notification runs when clicked (terminal-notifier `-execute`).
//
// `watch` is interactive — it blocks until its stream window is closed, and
// refuses to run without a controlling TTY. terminal-notifier runs `-execute`
// through /bin/sh with no TTY, so the click opens a Terminal window that runs
// `watch` there (a TTY, and a Ctrl-C to stop it).

/** POSIX single-quote a string so it's safe as one shell argument. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * argv that re-runs this sportsing: the binary itself when compiled
 * (`bun build --compile`; the entry lives in Bun's virtual /$bunfs), else the
 * Bun runtime plus the entry script (the npm install runs src/index.ts).
 */
export function selfInvocation(main = Bun.main, execPath = process.execPath): string[] {
  const compiled = main.startsWith("/$bunfs/") || main.includes("~BUN");
  return compiled ? [execPath] : [execPath, main];
}

/** `<exe…> <sport> watch <team>`, shell-quoted. */
export function watchCommand(exe: string[], sport: string, team: string): string {
  return `${exe.map(shQuote).join(" ")} ${sport} watch ${shQuote(team)}`;
}

/** Escape a string for an AppleScript double-quoted literal. */
function osaString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A shell command that runs `cmd` in a new macOS Terminal window and brings
 *  Terminal to the front. */
export function inTerminal(cmd: string): string {
  const script = (line: string) => `-e ${shQuote(`tell application "Terminal" to ${line}`)}`;
  return `osascript ${script(`do script ${osaString(cmd)}`)} ${script("activate")}`;
}
