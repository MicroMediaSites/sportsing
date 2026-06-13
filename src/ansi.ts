// Tiny ANSI helper — no dependencies. Honors NO_COLOR and non-TTY output.

const enabled = process.env.NO_COLOR == null && process.stdout.isTTY === true;

const wrap = (open: number, close: number) => (s: string | number) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);

export const c = {
  reset: "\x1b[0m",
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  white: wrap(97, 39),
  bgGreen: wrap(42, 49),
  bgRed: wrap(41, 49),
};

/** Visible length, ignoring ANSI escape codes — for column alignment. */
export function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad a (possibly colored) string to a visible width. */
export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  const gap = Math.max(0, width - visibleLen(s));
  const spaces = " ".repeat(gap);
  return align === "left" ? s + spaces : spaces + s;
}
