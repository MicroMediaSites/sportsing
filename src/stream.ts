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
import { c } from "./ansi.ts";

/** Shared persistent Chrome profile — one login per provider, reused across launches. */
export const STREAM_PROFILE_DIR = join(homedir(), ".config", "sportsball", "chrome");

export interface Provider {
  label: string;
  hub: string;
}

// US WC 2026 rights: English on Fox (→ Fubo), Spanish on Telemundo (→ Peacock).
export const PROVIDERS: Record<string, Provider> = {
  peacock: { label: "Peacock", hub: "https://www.peacocktv.com" },
  fubo: { label: "Fubo", hub: "https://www.fubo.tv" },
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

/**
 * Open `url` in a persistent-profile app-mode Chrome window via ui-leaf and
 * block until it closes. Ctrl-C tears the window down.
 */
export async function launchStream(url: string, label: string): Promise<void> {
  if (!Bun.which("ui-leaf")) {
    console.error(c.yellow("Streaming needs the `ui-leaf` CLI (>=1.3.0)."));
    console.error(c.dim("Install it: npm i -g @openthink/ui-leaf@latest"));
    process.exitCode = 1;
    return;
  }

  // Embed the view + write it to a temp viewsRoot at launch, so this works from
  // the compiled binary (no views/ dir to ship alongside it).
  const viewsRoot = await mkdtemp(join(tmpdir(), "sportsball-stream-"));
  await writeFile(join(viewsRoot, "stream.tsx"), REDIRECT_VIEW);
  await mkdir(STREAM_PROFILE_DIR, { recursive: true });

  const config = {
    version: "1",
    view: "stream",
    viewsRoot,
    data: { url, label },
    shell: "app",
    profile: { dir: STREAM_PROFILE_DIR },
    port: 0,
  };

  const proc = Bun.spawn(["ui-leaf", "mount"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  proc.stdin.write(JSON.stringify(config) + "\n");
  // Hold stdin open — do NOT end it (EOF tears the window down).

  console.log(c.bold(c.cyan(`⚽ Opening ${label}`)) + c.dim(`  ${url}`));
  console.log(c.dim("Close the window (or press Ctrl-C) when you're done."));

  const stop = () => {
    proc.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await proc.exited;
}
