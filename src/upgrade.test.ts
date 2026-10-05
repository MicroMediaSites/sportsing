import { test, expect } from "bun:test";
// Pure helpers only — no network, no real install.
import {
  detectInstall,
  canSelfUpgrade,
  installCommand,
  compareVersions,
  manualUpgradeHint,
  parseRegistryLatest,
  parseVersionOutput,
} from "./upgrade.ts";

const NVM = "/Users/me/.nvm/versions/node/v24.11.0";

test("detectInstall: npm global under nvm resolves the prefix", () => {
  expect(detectInstall(`${NVM}/lib/node_modules/sportsing/src/index.ts`)).toEqual({ kind: "npm-global", prefix: NVM });
  expect(detectInstall("/usr/local/lib/node_modules/sportsing/src/index.ts")).toEqual({ kind: "npm-global", prefix: "/usr/local" });
});

test("detectInstall: bun global", () => {
  expect(detectInstall("/Users/me/.bun/install/global/node_modules/sportsing/src/index.ts")).toEqual({
    kind: "bun-global",
    bunInstall: "/Users/me/.bun",
  });
});

test("detectInstall: npx and bunx caches are ephemeral", () => {
  expect(detectInstall("/Users/me/.npm/_npx/abc123/node_modules/sportsing/src/index.ts").kind).toBe("ephemeral");
  expect(detectInstall("/private/tmp/bunx-501-sportsing@latest/node_modules/sportsing/src/index.ts").kind).toBe("ephemeral");
});

test("detectInstall: source checkout, compiled binary, local dependency", () => {
  expect(detectInstall("/Users/me/Development/sportsing/src/index.ts")).toEqual({ kind: "source", root: "/Users/me/Development/sportsing" });
  expect(detectInstall("/$bunfs/root/sportsing").kind).toBe("compiled");
  expect(detectInstall("B:/~BUN/root/sportsing.exe").kind).toBe("compiled");
  expect(detectInstall("/Users/me/Development/sportsing/dist/sportsing").kind).toBe("compiled");
  expect(detectInstall("/Users/me/proj/node_modules/sportsing/src/index.ts").kind).toBe("unknown");
});

test("canSelfUpgrade only for npm/bun global", () => {
  expect(canSelfUpgrade({ kind: "npm-global", prefix: "/x" })).toBe(true);
  expect(canSelfUpgrade({ kind: "bun-global", bunInstall: "/x" })).toBe(true);
  for (const kind of ["ephemeral", "compiled", "unknown"] as const) expect(canSelfUpgrade({ kind })).toBe(false);
  expect(canSelfUpgrade({ kind: "source", root: "/x" })).toBe(false);
});

test("manualUpgradeHint covers every non-self-upgradable kind", () => {
  expect(manualUpgradeHint({ kind: "source", root: "/r" })).toContain("git pull");
  expect(manualUpgradeHint({ kind: "compiled" })).toContain("bun run build");
  expect(manualUpgradeHint({ kind: "ephemeral" })).toContain("npx sportsing@latest");
  expect(manualUpgradeHint({ kind: "unknown" })).toContain("sportsing@latest");
});

test("installCommand: npm prefers the prefix's own node + npm and pins --prefix", () => {
  const all = () => true;
  expect(installCommand({ kind: "npm-global", prefix: NVM }, all)).toEqual({
    cmd: [`${NVM}/bin/node`, `${NVM}/bin/npm`, "install", "-g", "--prefix", NVM, "sportsing@latest"],
    bin: `${NVM}/bin/sportsing`,
  });
  const npmOnly = (p: string) => p.endsWith("/npm");
  expect(installCommand({ kind: "npm-global", prefix: NVM }, npmOnly).cmd.slice(0, 2)).toEqual([`${NVM}/bin/npm`, "install"]);
  const none = () => false;
  expect(installCommand({ kind: "npm-global", prefix: "/opt" }, none).cmd).toEqual(["npm", "install", "-g", "--prefix", "/opt", "sportsing@latest"]);
});

test("installCommand: bun global", () => {
  expect(installCommand({ kind: "bun-global", bunInstall: "/h/.bun" }, () => false)).toEqual({
    cmd: ["bun", "add", "-g", "sportsing@latest"],
    bin: "/h/.bun/bin/sportsing",
  });
  expect(installCommand({ kind: "bun-global", bunInstall: "/h/.bun" }, () => true).cmd[0]).toBe("/h/.bun/bin/bun");
});

test("compareVersions: numeric, not lexical", () => {
  expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
  expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("0.2.0", "0.2.1")).toBe(-1);
  expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
});

test("compareVersions: prereleases sort below the release", () => {
  expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
  expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
  expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
  expect(compareVersions("1.0.0-alpha.1", "1.0.0-beta")).toBe(-1);
  expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
});

test("compareVersions: rejects garbage", () => {
  expect(() => compareVersions("latest", "1.0.0")).toThrow();
});

test("parseRegistryLatest", () => {
  expect(parseRegistryLatest({ name: "sportsing", version: "0.3.0" })).toBe("0.3.0");
  expect(() => parseRegistryLatest({})).toThrow();
  expect(() => parseRegistryLatest(null)).toThrow();
  expect(() => parseRegistryLatest({ version: "nope" })).toThrow();
});

test("parseVersionOutput", () => {
  expect(parseVersionOutput("sportsing 0.3.0\n")).toBe("0.3.0");
  expect(parseVersionOutput("sportsing 1.0.0-rc.1")).toBe("1.0.0-rc.1");
  expect(parseVersionOutput("command not found")).toBeNull();
});
