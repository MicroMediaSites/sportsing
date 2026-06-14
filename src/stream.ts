// Launch a live-stream window via ui-leaf (>=1.3.0): a chromeless app-mode
// Chrome window on a *persistent* profile (so provider logins survive), pointed
// at a streaming URL through a tiny redirect view.
//
// Why a redirect view: ui-leaf is bring-your-own-view (it serves a local view),
// so we serve a one-line view that navigates the window to the external
// provider URL. The window survives the navigation; the persistent profile keeps
// the login. Critically, we hold ui-leaf's stdin OPEN for the window's lifetime —
// closing stdin (EOF) tears the window down.

import { homedir, tmpdir } from "os";
import { join } from "path";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { rmSync } from "fs";
import { c } from "./ansi.ts";

/** Persistent Chrome profile path for a provider — one per provider so logins
 *  don't collide and two providers can run concurrently. */
export function profileDir(provider: string): string {
  return join(homedir(), ".config", "sportsing", "chrome-" + provider.trim().toLowerCase());
}

/**
 * Open `url` in the user's default browser (fire-and-forget). For public pages
 * like a YouTube highlights search — no persistent profile or app window needed,
 * unlike launchStream. argv-array form (no shell), so the URL can't inject.
 */
export function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

export interface Provider {
  label: string;
  hub: string;
}

// US WC 2026 rights: English on Fox (→ Fubo), Spanish on Telemundo (→ Peacock).
export const PROVIDERS: Record<string, Provider> = {
  // Land on the World Cup section (not the generic home) so the deep-link can
  // find the game tiles.
  peacock: { label: "Peacock", hub: "https://www.peacocktv.com/watch/sports-La-Copa-Mundial-de-la-FIFA-2026" },
  fubo: { label: "Fubo", hub: "https://www.fubo.tv/p/world-cup" },
};

const REDIRECT_VIEW = `import { useEffect } from "react";
import type { ViewProps } from "@openthink/ui-leaf/view";
interface StreamData { url?: string; label?: string }
export default function Stream({ data }: ViewProps<StreamData>) {
  useEffect(() => { if (data.url) window.location.replace(data.url); }, []);
  return (
    <div style={{ fontFamily: "system-ui", padding: "2rem", color: "#bbb", background: "#111", height: "100vh" }}>
      Opening {data.label ?? "stream"}…
    </div>
  );
}
`;

export interface StreamWindow {
  /** Resolves when the window/mount exits (cleans up the temp viewsRoot). */
  exited: Promise<void>;
  /** Kill the window and clean up. */
  close(): void;
}

/**
 * Spawn a persistent-profile app-mode Chrome window forwarded to `url`, without
 * blocking or installing signal handlers — the caller owns lifecycle. Pass
 * `debugPort` to expose CDP (for the overlay). Returns null if ui-leaf is absent.
 */
export async function spawnStreamWindow(
  url: string,
  label: string,
  opts: { debugPort?: number; windowSize?: { width: number; height: number } } = {},
): Promise<StreamWindow | null> {
  if (!Bun.which("ui-leaf")) {
    console.error(c.yellow("Streaming needs the `ui-leaf` CLI (>=1.3.0)."));
    console.error(c.dim("Install it: npm i -g @openthink/ui-leaf@latest"));
    return null;
  }

  // Embed the view + write it to a temp viewsRoot at launch, so this works from
  // the compiled binary (no views/ dir to ship alongside it).
  const viewsRoot = await mkdtemp(join(tmpdir(), "sportsing-stream-"));
  await writeFile(join(viewsRoot, "stream.tsx"), REDIRECT_VIEW);
  const dir = profileDir(label);
  await mkdir(dir, { recursive: true });

  const config = {
    version: "1",
    view: "stream",
    viewsRoot,
    data: { url, label },
    shell: "app",
    profile: { dir },
    ...(opts.debugPort ? { debugPort: opts.debugPort } : {}),
    ...(opts.windowSize ? { windowSize: opts.windowSize } : {}),
    port: 0,
  };

  const cleanup = () => {
    try {
      rmSync(viewsRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  const proc = Bun.spawn(["ui-leaf", "mount"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  proc.stdin.write(JSON.stringify(config) + "\n");
  // Hold stdin open — do NOT end it (EOF tears the window down).

  return {
    exited: proc.exited.then(() => cleanup()),
    close: () => {
      proc.kill();
      cleanup();
    },
  };
}

/**
 * Open `url` in a persistent-profile app-mode Chrome window and block until it
 * closes. Ctrl-C tears the window down.
 */
export async function launchStream(
  url: string,
  label: string,
  opts: { windowSize?: { width: number; height: number } } = {},
): Promise<void> {
  const win = await spawnStreamWindow(url, label, opts);
  if (!win) {
    process.exitCode = 1;
    return;
  }

  console.log(c.bold(c.cyan(`⚽ Opening ${label}`)) + c.dim(`  ${url}`));
  console.log(c.dim("Close the window (or press Ctrl-C) when you're done."));

  const stop = () => {
    win.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await win.exited;
}
