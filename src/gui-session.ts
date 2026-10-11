import { c } from "./ansi.ts";

export const NO_GUI_SESSION_WARNING =
  "This terminal isn't attached to the Mac's desktop session (ssh/tmux), so the stream window can't open on its screen. " +
  "Run this from Terminal on that Mac itself — not over ssh, and not in a tmux started over ssh.";

/** `launchctl managername` ("Aqua" = the logged-in desktop session; "Background"/"System" = not), or null if unavailable. */
export function launchctlManagerName(): string | null {
  try {
    const r = Bun.spawnSync(["launchctl", "managername"], { stdout: "pipe", stderr: "ignore" });
    if (r.exitCode !== 0) return null;
    return r.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Why a stream window likely can't open on this Mac's screen, or null if
 * nothing looks wrong. macOS only. When the launchd manager name is known it
 * decides (tmux started over ssh may have no SSH_* vars, yet is not Aqua); else
 * SSH_CONNECTION / SSH_TTY are the fallback signal.
 */
export function guiSessionProblem(
  env: Record<string, string | undefined>,
  platform: string,
  managerName: string | null,
): string | null {
  if (platform !== "darwin") return null;
  if (managerName) return managerName === "Aqua" ? null : NO_GUI_SESSION_WARNING;
  return env.SSH_CONNECTION || env.SSH_TTY ? NO_GUI_SESSION_WARNING : null;
}

/** Print the warning (never fails) if this process has no desktop session. */
export function warnIfNoGuiSession(): void {
  const problem = guiSessionProblem(
    process.env,
    process.platform,
    process.platform === "darwin" ? launchctlManagerName() : null,
  );
  if (problem) console.warn(c.yellow(problem));
}
