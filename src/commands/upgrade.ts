import { existsSync, realpathSync } from "fs";
import { c } from "../ansi.ts";
import {
  REGISTRY_LATEST_URL,
  canSelfUpgrade,
  compareVersions,
  describeInstall,
  detectInstall,
  installCommand,
  manualUpgradeHint,
  parseRegistryLatest,
  parseVersionOutput,
} from "../upgrade.ts";

const FETCH_TIMEOUT_MS = 10_000;

function usage(): void {
  console.log(`${c.bold("sportsing upgrade")} — install the latest npm release

  sportsing upgrade            reinstall sportsing@latest with the package manager that installed it
  sportsing upgrade --check    just report current vs latest; installs nothing`);
}

function fail(msg: string): void {
  console.error(c.red(msg));
  process.exitCode = 1;
}

async function fetchLatest(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(REGISTRY_LATEST_URL, {
      headers: { "User-Agent": "sportsing", Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : String((e as Error)?.message ?? e);
    throw new Error(`Couldn't reach the npm registry (${why}).`);
  }
  if (!res.ok) throw new Error(`npm registry returned ${res.status} ${res.statusText}.`);
  return parseRegistryLatest(await res.json());
}

/** Realpath of the running entry script, so npm/bun bin symlinks resolve to the package. */
function runningScript(): string {
  try {
    return realpathSync(Bun.main);
  } catch {
    return Bun.main; // compiled binaries report a virtual /$bunfs path
  }
}

/** Ask the freshly installed copy its version (falls back to null if it can't be run). */
function installedVersion(bin: string): string | null {
  if (!existsSync(bin)) return null;
  try {
    // Run it under this same Bun so the bin's `#!/usr/bin/env bun` shebang doesn't matter.
    const r = Bun.spawnSync([process.execPath, realpathSync(bin), "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 ? parseVersionOutput(r.stdout.toString()) : null;
  } catch {
    return null;
  }
}

// `sportsing upgrade [--check]` — self-update to the latest npm release.
export async function upgrade(args: string[], current: string): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") return usage();
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length) {
    usage();
    return fail(`Unknown argument: ${unknown.join(" ")}`);
  }
  const check = args.includes("--check");
  const install = detectInstall(runningScript());

  // Refuse unsupported installs up front — no network needed to say "not from here".
  if (!check && !canSelfUpgrade(install)) {
    console.error(c.yellow(`sportsing upgrade can't update a ${describeInstall(install)}.`));
    console.error(manualUpgradeHint(install));
    process.exitCode = 1;
    return;
  }

  let latest: string;
  try {
    latest = await fetchLatest();
  } catch (e) {
    return fail(`Error: ${(e as Error).message} Nothing was changed.`);
  }

  const cmp = compareVersions(current, latest);
  const status =
    cmp < 0
      ? c.yellow(`update available: ${current} → ${latest}`)
      : cmp === 0
        ? c.green(`up to date (${current})`)
        : c.dim(`running ${current}, ahead of the latest release ${latest}`);

  if (check) {
    console.log(`sportsing ${current}  ${c.dim("latest")} ${latest}  — ${status}`);
    console.log(c.dim(`installed as: ${describeInstall(install)}`));
    if (cmp < 0) {
      console.log(canSelfUpgrade(install) ? c.dim("run `sportsing upgrade` to install it") : c.dim(manualUpgradeHint(install)));
    }
    return;
  }

  if (cmp >= 0) {
    console.log(`sportsing is ${status}.`);
    return;
  }
  if (!canSelfUpgrade(install)) return; // narrowed above; keeps the type checker honest

  const { cmd, bin } = installCommand(install, existsSync);
  console.log(c.dim(`Upgrading sportsing ${current} → ${latest} via: ${cmd.join(" ")}`));
  let code: number;
  try {
    const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    code = await proc.exited;
  } catch (e) {
    return fail(`Error: couldn't run ${cmd[0]} (${(e as Error).message}). Nothing was changed.`);
  }
  if (code !== 0) {
    return fail(`Error: ${cmd.join(" ")} exited ${code}. The upgrade failed; your existing install was left as-is.`);
  }

  const now = installedVersion(bin);
  if (!now) {
    console.error(c.yellow(`Install finished, but couldn't confirm the new version from ${bin}. Check with: sportsing --version`));
    process.exitCode = 1;
    return;
  }
  if (compareVersions(now, current) <= 0) {
    return fail(`Install finished, but ${bin} still reports ${now}. Check which sportsing is on your PATH.`);
  }
  console.log(c.green(`✓ sportsing ${current} → ${now}`));
}
