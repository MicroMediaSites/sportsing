// The "ask bus" — a file-based mailbox that bridges sportsing's AI features to
// an EXTERNAL Claude agent the user keeps running. sportsing NEVER spawns
// `claude -p` or an agent-sdk call; instead it posts a question to this bus, and
// a separate Claude session (looping `sportsing fifa ask --next`) picks it up,
// answers succinctly, and posts the answer back. The overlay / analyze / predict
// caller waits for the answer and renders it.
//
// Protocol (in ~/.cache/sportsing/ask/):
//   q-<id>.json  — a question (written by the caller, read by the agent)
//   a-<id>.json  — its answer (written by the agent, read by the caller)
// Files are written atomically (.tmp + rename) so a watcher never reads a
// partial file. The waiting caller deletes both once it has the answer.

import { mkdir, readdir, readFile, writeFile, rename, unlink, chmod } from "fs/promises";
import { join } from "path";
import { CACHE_DIR } from "./config.ts";
import { fenceSafe } from "./prompt-fence.ts";

const BUS_DIR = join(CACHE_DIR, "ask");
const Q_PREFIX = "q-";
const A_PREFIX = "a-";
const STALE_MS = 5 * 60_000; // a question nobody answered in 5 min is abandoned

export type AskSource = "overlay" | "analyze" | "predict" | "catchup";

export interface AskQuestion {
  id: string;
  source: AskSource;
  /** The full, self-contained prompt the agent should answer. */
  question: string;
  /** Short human label (e.g. "BRA 1-0 ARG, 56'") shown to the agent for context. */
  context?: string;
  /** How to answer (length/format guidance), surfaced to the agent. */
  hint: string;
  /** Hard cap applied to the answer at delivery time (overlay), or null for none. */
  maxChars: number | null;
  ts: number;
}

// The bus carries untrusted viewer questions and the answers an agent posts
// back; both can contain free text. Keep the whole mailbox owner-only (0700) so
// nothing on a shared machine can read or tamper with in-flight Q&A.
async function ensureDir(): Promise<void> {
  await mkdir(BUS_DIR, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask and a no-op if the dir already exists, so
  // assert 0700 explicitly (best-effort — a foreign-owned dir just stays as-is).
  await chmod(BUS_DIR, 0o700).catch(() => {});
}

const ID_RE = /^ask_[a-z0-9]+$/;

function newId(): string {
  return "ask_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// IDs become file paths, so a caller-supplied id (e.g. `ask --reply <id>`) must
// be validated before it touches the filesystem — otherwise `../…` could escape
// the bus dir on read or write.
function assertId(id: string): void {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`invalid ask id: ${JSON.stringify(id)}`);
}

const HEARTBEAT_FILE = join(BUS_DIR, ".serving");

/** A serving agent (`serve` / `ask --next`) refreshes this while it waits, so a
 *  caller can tell whether anyone is listening before posting a question that
 *  would otherwise just time out. */
export async function touchHeartbeat(): Promise<void> {
  await ensureDir();
  await writeFile(HEARTBEAT_FILE, String(Date.now()), { mode: 0o600 }).catch(() => {});
}

/** True if a serving agent refreshed the heartbeat within `maxAgeMs` (default
 *  90s — comfortably longer than a `serve` loop's gap between ticks). */
export async function isServing(maxAgeMs = 90_000): Promise<boolean> {
  try {
    const ts = Number(await readFile(HEARTBEAT_FILE, "utf8"));
    return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, path); // atomic on the same filesystem
}

/** Post a question to the bus; returns its id.
 *  `context` is a short label built from untrusted API fields (team names, the
 *  fixture string) and gets rendered straight into the serving agent's prompt by
 *  `serve`/`next`/`list`. Sanitize it here — the single chokepoint every caller
 *  goes through — so it can't smuggle fence tags or control chars into that
 *  prompt regardless of which command posted it. (`question` is already fenced by
 *  its builder; the prompt-fence is idempotent, so double-fencing is harmless.) */
export async function postQuestion(q: Omit<AskQuestion, "id" | "ts">): Promise<string> {
  await ensureDir();
  const id = newId();
  const context = q.context === undefined ? undefined : fenceSafe(q.context);
  const full: AskQuestion = { ...q, context, id, ts: Date.now() };
  await writeJsonAtomic(join(BUS_DIR, Q_PREFIX + id + ".json"), full);
  return id;
}

/** Wait until an answer for `id` lands (or `timeoutMs` elapses). Cleans up both
 *  the question and answer files on the way out. Returns the answer, or null on
 *  timeout (no agent answered). */
export async function waitForAnswer(id: string, timeoutMs: number): Promise<string | null> {
  assertId(id);
  await ensureDir();
  const aPath = join(BUS_DIR, A_PREFIX + id + ".json");
  const qPath = join(BUS_DIR, Q_PREFIX + id + ".json");
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const { answer } = JSON.parse(await readFile(aPath, "utf8"));
        return typeof answer === "string" ? answer : "";
      } catch {
        /* not answered yet */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  } finally {
    await unlink(qPath).catch(() => {});
    await unlink(aPath).catch(() => {});
  }
}

/** Pending (unanswered, non-stale) questions, oldest first. */
export async function listPending(): Promise<AskQuestion[]> {
  await ensureDir();
  const files = await readdir(BUS_DIR).catch(() => [] as string[]);
  const answered = new Set(files.filter((f) => f.startsWith(A_PREFIX)).map((f) => f.slice(A_PREFIX.length)));
  const now = Date.now();
  const out: AskQuestion[] = [];
  for (const f of files) {
    if (!f.startsWith(Q_PREFIX) || !f.endsWith(".json")) continue;
    if (answered.has(f.slice(Q_PREFIX.length))) continue; // already has an answer waiting
    try {
      const q: AskQuestion = JSON.parse(await readFile(join(BUS_DIR, f), "utf8"));
      // Validate shape so a malformed file (e.g. non-numeric ts) is skipped
      // visibly rather than producing NaN comparisons downstream.
      if (ID_RE.test(q?.id ?? "") && typeof q.question === "string" && typeof q.ts === "number" && now - q.ts <= STALE_MS) {
        out.push(q);
      }
    } catch {
      /* partial/malformed — skip */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** The oldest pending question, optionally blocking up to `waitMs` for one. When
 *  `markServing` is set, refreshes the serving heartbeat each poll so callers can
 *  detect that an agent is listening (used by `serve` / `ask --next`). */
export async function nextPending(waitMs = 0, markServing = false): Promise<AskQuestion | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (markServing) await touchHeartbeat();
    const pending = await listPending();
    if (pending.length) return pending[0]!;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Deliver an answer for `id`. Applies the question's maxChars cap if set.
 *  Returns false if the question is unknown (timed out / already cleaned up). */
export async function postAnswer(id: string, answer: string): Promise<boolean> {
  assertId(id);
  await ensureDir();
  let maxChars: number | null = null;
  try {
    const q: AskQuestion = JSON.parse(await readFile(join(BUS_DIR, Q_PREFIX + id + ".json"), "utf8"));
    maxChars = q.maxChars;
  } catch {
    return false; // unknown id
  }
  let text = answer.trim();
  if (maxChars && text.length > maxChars) text = text.slice(0, maxChars - 1).trimEnd() + "…";
  await writeJsonAtomic(join(BUS_DIR, A_PREFIX + id + ".json"), { id, answer: text });
  return true;
}
