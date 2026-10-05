// The NBA/NHL live-stats overlay (`sportsing nba watch --overlay`), injected
// onto the stream page over CDP. Same chrome as the FIFA overlay (overlay.ts):
// a floating gear, a settings modal with per-league panel checkboxes and the
// spoiler-delay slider, and a stats window that appears once a panel is on.
// It follows the game you open: the page title's English team names
// (league-detect.ts) pick the game off ESPN's scoreboard, and its box score
// fills the panels (league-panels.ts). Panel choices persist per provider and
// sport (`overlayPanels["fubo:nba"]`); the delay is per provider, shared with
// the FIFA overlay — it's the stream's latency.

import { c } from "./ansi.ts";
import { getLiveGame, getTeams, type EspnTeam } from "./espn.ts";
import { getOverlayPanels, getStreamDelay, setOverlayPanel, setStreamDelay } from "./config.ts";
import { attachToPage, freePort, type CdpSession } from "./cdp.ts";
import { spawnStreamWindow, type StreamWindow } from "./stream.ts";
import type { Game } from "./game.ts";
import type { LeagueConfig } from "./commands/league.ts";
import { gameBetween, teamsFromTitle } from "./league-detect.ts";
import { LEAGUE_PANELS, panelDefaults, type LeaguePanels, type PanelRow } from "./league-panels.ts";
import {
  JS_CALL,
  JS_CB,
  JS_DRAGGABLE,
  JS_ESC,
  JS_ROW,
  JS_SHELL_CREATE,
  JS_SHELL_WIRE,
  JS_SHOW,
  JS_SYNC_SETTINGS,
  STATS_CSS,
  snapshotAtDelay,
} from "./overlay.ts";

/** What the page renders for one game at one moment. */
export interface LeagueSnapshot {
  away: string;
  home: string;
  awayScore: string;
  homeScore: string;
  detail: string;
  rows: Record<string, PanelRow[]>;
  /** Local time the snapshot was fetched. */
  at: string;
}

/**
 * The page-side script for a league's overlay. `window.__sb.update(d)` takes
 * `{ panels, delay, game?: LeagueSnapshot }` — with no game yet, an enabled
 * stats window says to open one. Rows render away-left, home-right.
 */
export function leagueBootstrap(spec: LeaguePanels, icon: string): string {
  return [
    "(function(){",
    "if(window.__sbInit)return;window.__sbInit=true;",
    "var D=" + JSON.stringify(panelDefaults(spec)) + ";",
    "var PANELS=" + JSON.stringify(spec.panels) + ";",
    JS_ESC,
    JS_ROW,
    JS_SHOW,
    JS_CB,
    JS_DRAGGABLE,
    JS_CALL,
    "function mk(){",
    "  if(!document.body){return setTimeout(mk,200);}",
    "  if(document.getElementById('sb-gear'))return;",
    ...JS_SHELL_CREATE,
    "  var stats=document.createElement('div');stats.id='sb-stats';",
    "  stats.style.cssText='" + STATS_CSS + "';stats.style.width='300px';",
    "  stats.innerHTML='"
    + "<div id=\"sb-stats-head\" style=\"display:flex;align-items:center;justify-content:space-between;padding:7px 11px;cursor:move;color:#8b949e;font-size:11px;border-bottom:1px solid #21262d\"><span>" + icon + " live</span><span id=\"sb-fresh\"></span></div>"
    + "<div id=\"sb-body\" style=\"padding:9px 13px 11px\"></div>';",
    "  document.body.appendChild(stats);",
    ...JS_SHELL_WIRE,
    "}",
    "function anyPanel(P){for(var i=0;i<PANELS.length;i++)if(P[PANELS[i][0]])return true;return false;}",
    "var DIM='<div style=\"color:#8b949e;font-size:11px\">';",
    "window.__sb={",
    "  update:function(d){mk();var P=d.panels||{};",
    ...JS_SYNC_SETTINGS,
    "    show('sb-stats',anyPanel(P));var g=d.game,h='';",
    "    if(!g){h=DIM+'Open a game \\u2014 the overlay follows it.</div>';}else{",
    "      if(P.score)h+='<div style=\"display:flex;align-items:baseline;gap:8px\"><b style=\"flex:1\">'+esc(g.away+' '+g.awayScore+' @ '+g.home+' '+g.homeScore)+'</b><span style=\"color:#58a6ff;font-size:11px\">'+esc(g.detail)+'</span></div>';",
    "      for(var i=0;i<PANELS.length;i++){var k=PANELS[i][0];if(k==='score'||!P[k])continue;var rs=(g.rows&&g.rows[k])||[];",
    "        h+='<div style=\"margin-top:8px\">'+DIM+esc(PANELS[i][1])+' \\u00b7 '+esc(g.away)+' / '+esc(g.home)+'</div>';",
    "        if(!rs.length)h+=DIM+'no stats yet</div>';for(var j=0;j<rs.length;j++)h+=row(esc(rs[j].label),rs[j].away,rs[j].home);h+='</div>';}",
    "    }",
    "    var b=document.getElementById('sb-body');if(b)b.innerHTML=h;",
    "    var fr=document.getElementById('sb-fresh');if(fr)fr.textContent=g&&g.at?'\\u27f3 '+g.at:'';}",
    "};",
    "mk();",
    "})();",
  ].join("\n");
}

type OverlayLeague = Pick<LeagueConfig, "sport" | "league" | "label" | "icon" | "aliases">;

function specFor(cfg: OverlayLeague): LeaguePanels {
  const spec = LEAGUE_PANELS[cfg.league];
  if (!spec) throw new Error(`No overlay panels for ${cfg.label}.`);
  return spec;
}

/** Open the stream window with a debug port and inject the overlay. Null
 *  (exit code set) if the window can't launch; session undefined if CDP fails. */
async function openWithOverlay(
  url: string,
  providerLabel: string,
  bootstrap: string,
  windowSize: { width: number; height: number } | undefined,
): Promise<{ win: StreamWindow; session?: CdpSession } | null> {
  const port = await freePort();
  const win = await spawnStreamWindow(url, providerLabel, { debugPort: port, windowSize });
  if (!win) {
    process.exitCode = 1;
    return null;
  }
  try {
    const session = await attachToPage(port);
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.send("Runtime.addBinding", { name: "__sbCall" });
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await session.send("Runtime.evaluate", { expression: bootstrap });
    return { win, session };
  } catch (e) {
    console.error(c.yellow("Overlay unavailable (CDP attach failed) — stream is still open."));
    console.error(c.dim(e instanceof Error ? e.message : String(e)));
    return { win };
  }
}

/**
 * Launch the stream with the NBA/NHL overlay; blocks until the window closes.
 * `game` is the game to start on (null = wait for the page to name one);
 * `gamesNow` lists the games the page could be showing (recent + today), for
 * following a game picked on the page.
 */
export async function runLeagueOverlay(
  cfg: OverlayLeague,
  opts: {
    url: string;
    provider: { key: string; label: string };
    game: Game | null;
    gamesNow: () => Promise<Game[]>;
    windowSize?: { width: number; height: number };
  },
): Promise<void> {
  const spec = specFor(cfg);
  const opened = await openWithOverlay(opts.url, opts.provider.label, leagueBootstrap(spec, cfg.icon), opts.windowSize);
  if (!opened) return;
  const { win, session } = opened;

  console.log(c.bold(c.cyan(`${cfg.icon} Opening ${opts.provider.label} with the ${cfg.label} overlay`)) + c.dim(`  ${opts.url}`));
  console.log(c.dim("Just a floating ⚙ by default — click it to pick panels and sync the delay. The overlay follows the game you open."));

  const panelsKey = `${opts.provider.key}:${cfg.sport}`;
  let panels = await getOverlayPanels(panelsKey, panelDefaults(spec));
  let delaySec = (await getStreamDelay(opts.provider.key)) ?? 0;
  let current = opts.game;
  let buffer: { t: number; data: LeagueSnapshot }[] = [];
  let teams: EspnTeam[] = [];
  let lastTitle = "";
  let ticks = 0;
  let running = false;

  const push = (data: unknown) =>
    session?.send("Runtime.evaluate", { expression: "window.__sb&&window.__sb.update(" + JSON.stringify(data) + ")" }).catch(() => {});
  const render = () => push({ panels, delay: delaySec, game: snapshotAtDelay(buffer, delaySec, Date.now()) });

  const readTitle = async (): Promise<string> => {
    try {
      const r = await session?.send("Runtime.evaluate", { expression: "document.title", returnByValue: true });
      return r?.result?.result?.value ?? "";
    } catch {
      return "";
    }
  };

  // Follow the page: a title naming two of the league's teams switches to
  // their game (if it's one of today's). Anything else keeps the current game.
  const follow = async () => {
    const title = await readTitle();
    if (title === lastTitle) return;
    lastTitle = title;
    if (!teams.length) teams = await getTeams(cfg.league).catch(() => []);
    const ids = teamsFromTitle(title, teams, cfg.aliases);
    if (!ids) return;
    const found = gameBetween(await opts.gamesNow().catch(() => []), ids, Date.now());
    if (found && found.id !== current?.id) {
      current = found;
      buffer = [];
      console.log(c.dim(`Following ${found.name}.`));
    }
  };

  const tick = async () => {
    if (running || !session) return;
    running = true;
    try {
      await follow();
      if (current && ticks % 5 === 0) {
        try {
          const lg = await getLiveGame(cfg.league, current.id);
          if (lg) {
            buffer.push({
              t: Date.now(),
              data: {
                away: lg.away.abbreviation,
                home: lg.home.abbreviation,
                awayScore: lg.away.score,
                homeScore: lg.home.score,
                detail: lg.detail,
                rows: spec.rows(lg),
                at: new Date().toLocaleTimeString(),
              },
            });
            buffer = buffer.filter((b) => Date.now() - b.t <= 330_000); // keep > 5 min so a max delay has data
          }
        } catch {
          /* transient */
        }
      }
      render();
      ticks++;
    } finally {
      running = false;
    }
  };

  if (session) {
    session.onEvent(async (method, params) => {
      if (method !== "Runtime.bindingCalled" || params?.name !== "__sbCall") return;
      try {
        const msg = JSON.parse(params.payload ?? "{}");
        if (msg.fn === "delay" && typeof msg.set === "number") {
          delaySec = Math.min(300, Math.max(0, Math.round(msg.set))); // 0–5 min
          await setStreamDelay(opts.provider.key, delaySec);
          render();
        } else if (msg.fn === "pref" && typeof msg.key === "string") {
          panels = { ...panels, [msg.key]: !!msg.on };
          await setOverlayPanel(panelsKey, msg.key, !!msg.on);
          render();
        }
      } catch {
        /* malformed */
      }
    });
    await tick();
  }

  const poll = session ? setInterval(tick, 1_000) : null;
  const stop = () => {
    if (poll) clearInterval(poll);
    session?.close();
    win.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await win.exited;
  if (poll) clearInterval(poll);
  session?.close();
}

/**
 * `watch --overlay --smoke`: open the window, inject the overlay, render every
 * panel from an empty box score, and confirm over CDP that the gear and each
 * panel came up — then tear down and exit (1 on any failure). Bounded; for
 * scripts and agents.
 */
export async function smokeLeagueOverlay(
  cfg: OverlayLeague,
  url: string,
  providerLabel: string,
  windowSize: { width: number; height: number } | undefined,
): Promise<void> {
  const spec = specFor(cfg);
  const opened = await openWithOverlay(url, providerLabel, leagueBootstrap(spec, cfg.icon), windowSize);
  if (!opened) return;
  const { win, session } = opened;
  try {
    if (!session) throw new Error("CDP attach failed");
    const empty = { abbreviation: "AWY", score: "0", id: "", stats: {}, leaders: {}, goalies: [], timeoutsUsed: 0, periodFouls: 0 };
    const lg = { state: "pre" as const, detail: "smoke", period: 1, away: empty, home: { ...empty, abbreviation: "HOM" } };
    const game: LeagueSnapshot = { away: "AWY", home: "HOM", awayScore: "0", homeScore: "0", detail: "smoke", rows: spec.rows(lg), at: "" };
    const all = Object.fromEntries(spec.panels.map(([k]) => [k, true]));
    const titles = spec.panels.filter(([k]) => k !== "score").map(([, label]) => label);
    const check =
      "(function(){window.__sb.update(" + JSON.stringify({ panels: all, delay: 0, game }) + ");" +
      "var s=document.getElementById('sb-stats'),b=document.getElementById('sb-body');" +
      "if(!document.getElementById('sb-gear')||!s||s.style.display==='none'||!b)return false;" +
      "var t=b.textContent;return " + JSON.stringify(titles) + ".every(function(x){return t.indexOf(x)>=0;})&&t.indexOf('AWY 0 @ HOM 0')>=0;})()";
    // The window is still navigating (redirect view → provider), which re-injects
    // the overlay on the new document — so retry until the panels render there.
    let ok = false;
    for (let i = 0; i < 15 && !ok; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1_000));
      const r = await session.send("Runtime.evaluate", { expression: check, returnByValue: true }).catch(() => null);
      ok = r?.result?.result?.value === true;
    }
    session.close();
    if (!ok) throw new Error("the overlay didn't render its panels within 15s");
    console.log(c.green(`✓ watch --overlay --smoke: ${providerLabel} window opened and the ${cfg.label} overlay rendered — tearing it down.`));
  } catch (e) {
    console.error(c.yellow(`watch --overlay --smoke: ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  } finally {
    win.close();
  }
}
