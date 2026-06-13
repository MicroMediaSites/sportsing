// Run a one-shot local Claude (Claude Code headless `claude -p`) over a prompt
// and return its text. Used by analyze + predict — "give Claude the CLI output
// and let a local agent reason over it." Runs on the user's Claude Code
// subscription; no API key here.

export class ClaudeNotFoundError extends Error {}

/** Feed `prompt` to `claude -p` on stdin and return its stdout. */
export async function runClaude(prompt: string): Promise<string> {
  if (!Bun.which("claude")) throw new ClaudeNotFoundError();

  const proc = Bun.spawn(["claude", "-p"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`claude exited ${code}: ${(err.trim() || out.trim()).slice(0, 300)}`);
  }
  return out.trim();
}
