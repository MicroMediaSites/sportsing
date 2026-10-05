// Pure helpers behind `sportsing upgrade`: work out how the running copy was
// installed, compare versions, and build the reinstall command. No I/O here —
// the command (src/commands/upgrade.ts) does the realpath, fetch and spawn.

export const PACKAGE = "sportsing";
export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;

export type InstallMethod =
  /** `npm install -g` — the script lives at `<prefix>/lib/node_modules/sportsing/…`. */
  | { kind: "npm-global"; prefix: string }
  /** `bun add -g` — the script lives at `<bunInstall>/install/global/node_modules/sportsing/…`. */
  | { kind: "bun-global"; bunInstall: string }
  /** A one-off `npx` / `bunx` run out of a temp cache. */
  | { kind: "ephemeral" }
  /** `bun run build`'s standalone `dist/sportsing`. */
  | { kind: "compiled" }
  /** A git checkout run with `bun run src/index.ts`. */
  | { kind: "source"; root: string }
  /** A project-local dependency or anything else we don't recognise. */
  | { kind: "unknown" };

const PKG_SEG = `/node_modules/${PACKAGE}/`;

/**
 * Classify the running copy from the realpath of its entry script (`Bun.main`).
 * Order matters: temp caches also contain `node_modules/sportsing/`, so they're
 * ruled out before the global-install patterns.
 */
export function detectInstall(scriptPath: string): InstallMethod {
  const p = scriptPath.replace(/\\/g, "/");

  // Compiled binaries report a virtual path inside Bun's embedded filesystem.
  if (p.includes("/$bunfs/") || p.includes("~BUN/")) return { kind: "compiled" };

  if (p.includes(PKG_SEG)) {
    // npx: ~/.npm/_npx/<hash>/node_modules/sportsing; bunx: $TMPDIR/bunx-<uid>-sportsing@…/node_modules/sportsing
    if (p.includes("/_npx/") || /\/bunx-[^/]*\//.test(p)) return { kind: "ephemeral" };

    const bun = p.match(/^(.*)\/install\/global\/node_modules\/sportsing\//);
    if (bun) return { kind: "bun-global", bunInstall: bun[1]! };

    const npm = p.match(/^(.*)\/lib\/node_modules\/sportsing\//);
    if (npm) return { kind: "npm-global", prefix: npm[1]! };

    return { kind: "unknown" };
  }

  const src = p.match(/^(.*)\/src\/index\.ts$/);
  if (src) return { kind: "source", root: src[1]! };

  // A compiled binary renamed or run from a real path (older Bun / other OS).
  if (!p.endsWith(".ts") && !p.endsWith(".js")) return { kind: "compiled" };

  return { kind: "unknown" };
}

export function canSelfUpgrade(m: InstallMethod): m is Extract<InstallMethod, { kind: "npm-global" | "bun-global" }> {
  return m.kind === "npm-global" || m.kind === "bun-global";
}

/** Human description of the install, for status lines. */
export function describeInstall(m: InstallMethod): string {
  switch (m.kind) {
    case "npm-global":
      return `npm global install (${m.prefix})`;
    case "bun-global":
      return `bun global install (${m.bunInstall})`;
    case "ephemeral":
      return "npx/bunx temporary cache";
    case "compiled":
      return "compiled standalone binary";
    case "source":
      return `source checkout (${m.root})`;
    case "unknown":
      return "unrecognised install";
  }
}

/** How to update an install `sportsing upgrade` won't touch itself. */
export function manualUpgradeHint(m: InstallMethod): string {
  switch (m.kind) {
    case "source":
      return `This is a source checkout. Update it with git:\n  cd ${m.root} && git pull && bun install`;
    case "compiled":
      return "This is a compiled standalone binary. Rebuild it from an updated checkout:\n  git pull && bun install && bun run build";
    case "ephemeral":
      return `This is a temporary npx/bunx copy. Run the latest directly:\n  npx ${PACKAGE}@latest   (or: bunx ${PACKAGE}@latest)\nor install it globally so \`sportsing upgrade\` can manage it:\n  npm install -g ${PACKAGE}   (or: bun add -g ${PACKAGE})`;
    case "unknown":
      return `Couldn't tell how this copy was installed. Reinstall it with your package manager:\n  npm install -g ${PACKAGE}@latest   (or: bun add -g ${PACKAGE}@latest)`;
    default:
      return "";
  }
}

export interface Command {
  cmd: string[];
  /** Where the upgraded `sportsing` bin lands, to confirm the new version. */
  bin: string;
}

/**
 * The reinstall command for a self-upgradable install. For npm, prefer the
 * node + npm sitting in that prefix (nvm's *active* node may be a different
 * version) and pin `--prefix` so the package lands back where it came from.
 * `exists` is injected so this stays pure.
 */
export function installCommand(
  m: Extract<InstallMethod, { kind: "npm-global" | "bun-global" }>,
  exists: (path: string) => boolean,
): Command {
  const spec = `${PACKAGE}@latest`;
  if (m.kind === "bun-global") {
    const localBun = `${m.bunInstall}/bin/bun`;
    return {
      cmd: [exists(localBun) ? localBun : "bun", "add", "-g", spec],
      bin: `${m.bunInstall}/bin/${PACKAGE}`,
    };
  }
  const node = `${m.prefix}/bin/node`;
  const npm = `${m.prefix}/bin/npm`;
  const runner = exists(npm) ? (exists(node) ? [node, npm] : [npm]) : ["npm"];
  return {
    cmd: [...runner, "install", "-g", "--prefix", m.prefix, spec],
    bin: `${m.prefix}/bin/${PACKAGE}`,
  };
}

interface Semver {
  core: [number, number, number];
  pre: string[];
}

function parseSemver(v: string): Semver | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

export function isValidVersion(v: string): boolean {
  return parseSemver(v) !== null;
}

/** semver precedence: -1 if a < b, 0 if equal, 1 if a > b. Throws on a malformed version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Not a semver version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i]! !== pb.core[i]!) return pa.core[i]! < pb.core[i]! ? -1 : 1;
  }
  // A release outranks any of its prereleases.
  if (!pa.pre.length || !pb.pre.length) {
    if (pa.pre.length === pb.pre.length) return 0;
    return pa.pre.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1; // numeric identifiers sort before alphanumeric
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Pull `version` out of the registry's `/<pkg>/latest` document. */
export function parseRegistryLatest(body: unknown): string {
  const v = (body as { version?: unknown } | null)?.version;
  if (typeof v !== "string" || !isValidVersion(v)) throw new Error("Registry response had no valid version.");
  return v;
}

/** Pull the version out of `sportsing --version` output (`sportsing 0.2.1`). */
export function parseVersionOutput(out: string): string | null {
  const m = out.match(/sportsing\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1]! : null;
}
