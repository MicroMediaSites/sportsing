// Launch a live-stream window via ui-leaf: a chromeless app-mode Chrome window
// on a *persistent* profile (so provider logins survive), pointed at a streaming
// URL through a tiny redirect view.
//
// ui-leaf is a declared dependency (`@openthink/ui-leaf`), driven through its
// `spawnUiLeaf` SDK — NOT a globally-installed CLI resolved off PATH. The version
// is pinned in package.json and the platform-specific native binary is fetched by
// ui-leaf's postinstall, so there's no separate global-install step and no
// version skew between sportsing and ui-leaf.
//
// Why a redirect view: ui-leaf is bring-your-own-view (it serves a local view),
// so we serve a one-line view that navigates the window to the external provider
// URL. The window survives the navigation; the persistent profile keeps the
// login. The SDK holds the binary's stdin open for the window's lifetime; the
// returned handle's kill() tears it down.

import { homedir, tmpdir } from "os";
import { join } from "path";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { rmSync, existsSync } from "fs";
import { mount } from "@openthink/ui-leaf";
import { c } from "./ansi.ts";

/** Persistent Chrome profile path for a provider — one per provider so logins
 *  don't collide and two providers can run concurrently. New profiles live under
 *  sportsing/, but if a pre-rebrand profile already exists we keep using it IN
 *  PLACE: it holds the provider's login cookies, and moving/copying a live Chrome
 *  profile is unsafe (Singleton locks) and would force re-authentication. */
export function profileDir(provider: string): string {
  const key = provider.trim().toLowerCase();
  const current = join(homedir(), ".config", "sportsing", "chrome-" + key);
  const legacy = join(homedir(), ".config", "sportsball", "chrome-" + key);
  if (!existsSync(current) && existsSync(legacy)) return legacy;
  return current;
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
 * installing signal handlers — the caller owns lifecycle. Pass `debugPort` to
 * expose CDP (for the overlay). Awaits the window coming up; returns null (with
 * an actionable message) if ui-leaf's native binary can't launch.
 */
export async function spawnStreamWindow(
  url: string,
  label: string,
  opts: { debugPort?: number; windowSize?: { width: number; height: number } } = {},
): Promise<StreamWindow | null> {
  // Embed the view + write it to a temp viewsRoot at launch, so this works from
  // the compiled binary (no views/ dir to ship alongside it).
  const viewsRoot = await mkdtemp(join(tmpdir(), "sportsing-stream-"));
  await writeFile(join(viewsRoot, "stream.tsx"), REDIRECT_VIEW);
  const dir = profileDir(label);
  await mkdir(dir, { recursive: true });

  const cleanup = () => {
    try {
      rmSync(viewsRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  // Teardown goes through an AbortSignal, not view.close(): aborting the signal
  // is the path the SDK wires to "send close, then SIGKILL after a 5s grace", so
  // it reliably reaps the ui-leaf/Chrome tree even if the binary stops responding
  // to the graceful close message. view.close() alone is graceful-only and can
  // hang. (This is the clean-reap behavior the old proc.kill() relied on.)
  const ac = new AbortController();

  // mount() resolves once the window is up and rejects if the native binary is
  // missing or the child dies before serving. The SDK resolves that binary from
  // this package's node_modules; a standalone `bun build --compile` artifact has
  // none, so honor UI_LEAF_BINARY_PATH as the escape hatch to point at one.
  let view;
  try {
    view = await mount({
      view: "stream",
      viewsRoot,
      data: { url, label },
      shell: "app",
      profile: { dir },
      ...(opts.debugPort ? { debugPort: opts.debugPort } : {}),
      ...(opts.windowSize ? { windowSize: opts.windowSize } : {}),
      port: 0,
      silent: true, // keep the launch quiet (matches the old stdout/stderr: "ignore")
      signal: ac.signal,
      ...(process.env.UI_LEAF_BINARY_PATH ? { binaryPath: process.env.UI_LEAF_BINARY_PATH } : {}),
    });
  } catch (err) {
    cleanup();
    console.error(c.yellow("Couldn't launch the ui-leaf browser window."));
    console.error(
      c.dim(
        "If you installed sportsing from npm, reinstall so its ui-leaf binary is fetched (npm i -g sportsing). " +
          "If you're running the standalone binary, set UI_LEAF_BINARY_PATH to an installed ui-leaf-bin.",
      ),
    );
    console.error(c.dim(String(err instanceof Error ? err.message : err)));
    return null;
  }

  return {
    exited: view.closed.then(() => cleanup()),
    close: () => {
      ac.abort();
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
