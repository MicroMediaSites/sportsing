// Neutralize untrusted text before embedding it inside a prompt fence
// (<match_data> / <match_events> / <viewer_question>). The AI features lean on
// that fence as the data/instruction boundary, but the delimiter itself was never
// escaped — a crafted API field or viewer string containing a literal
// `</match_data>` (followed by attacker instructions) would appear OUTSIDE the
// fence to the model, defeating it. fenceSafe strips any fence tag (open or close,
// any case/spacing) and replaces non-printing control chars (keeping tab/newline/CR).
const FENCE_TAGS = /<\/?\s*(?:match_data|match_events|viewer_question)\s*>/gi;

export function fenceSafe(s: unknown): string {
  const stripped = String(s ?? "").replace(FENCE_TAGS, "");
  let out = "";
  for (const ch of stripped) {
    const c = ch.charCodeAt(0);
    // keep tab (9), newline (10), CR (13); blank out other C0 control chars
    out += c < 32 && c !== 9 && c !== 10 && c !== 13 ? " " : ch;
  }
  return out;
}
