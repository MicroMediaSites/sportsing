// Minimal Chrome DevTools Protocol client. We attach to the stream window's
// page (launched by ui-leaf with `debugPort`, #66) to paint an overlay onto a
// page we don't control and talk to it live — the way that survives Chrome
// 149's `--load-extension` lockdown. Hand-rolled (no puppeteer dep) over the
// CDP websocket; zero runtime deps, same spirit as the rest of sportsing.

import { createServer } from "net";

/** Find a free loopback TCP port to hand to ui-leaf's debugPort. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export interface CdpSession {
  /** Send a CDP method; resolves with the full reply `{ id, result?, error? }`. */
  send(method: string, params?: unknown): Promise<any>;
  /** Subscribe to CDP events (no id), e.g. "Runtime.bindingCalled". */
  onEvent(handler: (method: string, params: any) => void): void;
  close(): void;
}

/**
 * Poll the debug endpoint for the window's page target, connect to its CDP
 * websocket, and return a session. The page target is stable across in-tab
 * navigations (localhost redirect → provider), so we attach once.
 */
export async function attachToPage(port: number, timeoutMs = 20_000): Promise<CdpSession> {
  const deadline = Date.now() + timeoutMs;
  let wsUrl: string | null = null;
  while (Date.now() < deadline) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* endpoint not up yet */
    }
    await Bun.sleep(250);
  }
  if (!wsUrl) throw new Error(`No CDP page target on 127.0.0.1:${port} (is debugPort supported?)`);
  if (!wsUrl.startsWith("ws://127.0.0.1:") && !wsUrl.startsWith("ws://localhost:")) {
    throw new Error(`Refusing non-loopback CDP endpoint: ${wsUrl}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("CDP websocket failed to open"));
  });

  let nextId = 0;
  const pending = new Map<number, (msg: any) => void>();
  const handlers: ((method: string, params: any) => void)[] = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const h of handlers) h(msg.method, msg.params);
    }
  };

  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, (msg) => (msg.error ? rej(new Error(`CDP ${method}: ${msg.error.message}`)) : res(msg)));
        ws.send(JSON.stringify({ id, method, params }));
      }),
    onEvent: (h) => handlers.push(h),
    close: () => ws.close(),
  };
}
