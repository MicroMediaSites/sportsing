// The NBA/NHL live-stats overlay (`sportsing nba watch --overlay`), injected
// onto the stream page over CDP. Same chrome as the FIFA overlay (overlay.ts):
// a floating gear, a settings modal with per-league panel checkboxes and the
// spoiler-delay slider, and a stats window that appears once a panel is on.
// It follows the game you open: the page title's English team names
// (league-detect.ts) pick the game off ESPN's scoreboard, and its box score
// fills the panels (league-panels.ts). "Get caught up" recaps the game up to
// the delayed stream's moment through the serve bus (league-ai.ts). Panel
// choices persist per provider and sport (`overlayPanels["fubo:nba"]`); the
// delay is per provider, shared with the FIFA overlay — it's the stream's latency.

import { c } from "./ansi.ts";
import { getGameSummary, getTeams, type EspnGameSummary, type EspnTeam } from "./espn.ts";
import { getOverlayPanels, getStreamDelay, setOverlayPanel, setStreamDelay } from "./config.ts";
import { attachToPage, freePort, type CdpSession } from "./cdp.ts";
import { deepLinkGame, leagueTileTerms } from "./deep-link.ts";
import { spawnStreamWindow, type StreamWindow } from "./stream.ts";
import type { Game } from "./game.ts";
import type { LeagueConfig } from "./commands/league.ts";
import { gameBetween, teamsFromTitle } from "./league-detect.ts";
import { LEAGUE_PANELS, SPECIAL_PANELS, panelDefaults, type LeaguePanels, type PanelRow } from "./league-panels.ts";
import { catchupInput, sportAiFor } from "./league-ai.ts";
import { requestRecap } from "./recap.ts";
import { isServing } from "./ask-bus.ts";
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
 * `{ panels, delay, serving, game?: LeagueSnapshot }` — with no game yet, an
 * enabled stats window says to open one. Rows render away-left, home-right.
 * `window.__sb.catchupResult(text)` fills the "Get caught up" output.
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
    + "<div style=\"padding:9px 13px 11px\"><div id=\"sb-body\"></div>"
    // "Get caught up" sits outside sb-body (re-rendered every tick) so its output persists.
    + "<div id=\"sb-pl-catchup\" style=\"display:none\"><button id=\"sb-catchup\" style=\"margin-top:10px;width:100%;padding:6px;background:#6e40c9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px\">Get caught up</button><div id=\"sb-catchup-status\" style=\"font-size:10px;margin-top:6px\"></div><div id=\"sb-catchup-out\" style=\"margin-top:8px;color:#c9d1d9;font-size:12px;white-space:pre-wrap\"></div></div>"
    + "</div>';",
    "  document.body.appendChild(stats);",
    ...JS_SHELL_WIRE,
    "  document.getElementById('sb-catchup').addEventListener('click',function(){document.getElementById('sb-catchup-out').textContent='Catching you up\u2026';call({fn:'catchup'});});",
    "}",
    "var SPECIAL=" + JSON.stringify(SPECIAL_PANELS) + ";",
    "function anyPanel(P){for(var i=0;i<PANELS.length;i++)if(P[PANELS[i][0]])return true;return false;}",
    "var DIM='<div style=\"color:#8b949e;font-size:11px\">';",
    "window.__sb={",
    "  update:function(d){mk();var P=d.panels||{};",
    ...JS_SYNC_SETTINGS,
    "    show('sb-stats',anyPanel(P));var g=d.game,h='';",
    "    if(!g){h=DIM+'Open a game \\u2014 the overlay follows it.</div>';}else{",
    "      if(P.score)h+='<div style=\"display:flex;align-items:baseline;gap:8px\"><b style=\"flex:1\">'+esc(g.away+' '+g.awayScore+' @ '+g.home+' '+g.homeScore)+'</b><span style=\"color:#58a6ff;font-size:11px\">'+esc(g.detail)+'</span></div>';",
    "      for(var i=0;i<PANELS.length;i++){var k=PANELS[i][0];if(SPECIAL.indexOf(k)>=0||!P[k])continue;var rs=(g.rows&&g.rows[k])||[];",
    "        h+='<div style=\"margin-top:8px\">'+DIM+esc(PANELS[i][1])+' \\u00b7 '+esc(g.away)+' / '+esc(g.home)+'</div>';",
    "        if(!rs.length)h+=DIM+'no stats yet</div>';for(var j=0;j<rs.length;j++)h+=row(esc(rs[j].label),rs[j].away,rs[j].home);h+='</div>';}",
    "    }",
    "    var b=document.getElementById('sb-body');if(b)b.innerHTML=h;",
    "    show('sb-pl-catchup',!!P.catchup);var cst=document.getElementById('sb-catchup-status');if(P.catchup&&cst){if(d.serving){cst.textContent='\u25cf Claude agent connected';cst.style.color='#3fb950';}else{cst.textContent='\u25cb No agent \u2014 run  /loop sportsing serve  to enable recaps';cst.style.color='#d29922';}}",
    "    var fr=document.getElementById('sb-fresh');if(fr)fr.textContent=g&&g.at?'\\u27f3 '+g.at:'';}",
    "  ,catchupResult:function(t){mk();var o=document.getElementById('sb-catchup-out');if(o)o.textContent=t||'(no response)';}",
    "};",
    "mk();",
    "})();",
  ].join("\n");
}

/** A summary → what the page renders (abbreviations, score, status, panel rows). */
export function snapshotOf(spec: LeaguePanels, s: EspnGameSummary): LeagueSnapshot {
  return {
    away: s.away.abbreviation || "?",
    home: s.home.abbreviation || "?",
    awayScore: s.away.score || "0",
    homeScore: s.home.score || "0",
    detail: s.detail,
    rows: spec.rows(s),
    at: new Date().toLocaleTimeString(),
  };
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
    /** Click `game`'s tile on the hub and start its player (deep-link.ts). */
    deepLink?: boolean;
  },
): Promise<void> {
  const spec = specFor(cfg);
  const opened = await openWithOverlay(opts.url, opts.provider.label, leagueBootstrap(spec, cfg.icon), opts.windowSize);
  if (!opened) return;
  const { win, session } = opened;
  const target = opts.game;
  if (session && opts.deepLink && target) {
    void deepLinkGame(session, leagueTileTerms(target.home.name), leagueTileTerms(target.away.name)).then((ok) => {
      if (!ok) console.log(c.dim(`Couldn't find ${target.name} on ${opts.provider.label} — pick it there and the overlay will follow.`));
    });
  }

  console.log(c.bold(c.cyan(`${cfg.icon} Opening ${opts.provider.label} with the ${cfg.label} overlay`)) + c.dim(`  ${opts.url}`));
  console.log(c.dim("Just a floating ⚙ by default — click it to pick panels and sync the delay. The overlay follows the game you open."));

  const panelsKey = `${opts.provider.key}:${cfg.sport}`;
  let panels = await getOverlayPanels(panelsKey, panelDefaults(spec));
  let delaySec = (await getStreamDelay(opts.provider.key)) ?? 0;
  let current = opts.game;
  // Each snapshot keeps its summary so "Get caught up" can recap up to the
  // delayed stream's moment — never past it.
  let buffer: { t: number; data: { snap: LeagueSnapshot; summary: EspnGameSummary } }[] = [];
  let teams: EspnTeam[] = [];
  let lastTitle = "";
  let ticks = 0;
  let running = false;
  let serving = false; // whether a Claude agent is answering the serve bus
  const ai = sportAiFor(cfg.league);

  const push = (data: unknown) =>
    session?.send("Runtime.evaluate", { expression: "window.__sb&&window.__sb.update(" + JSON.stringify(data) + ")" }).catch(() => {});
  const render = () => push({ panels, delay: delaySec, serving, game: snapshotAtDelay(buffer, delaySec, Date.now())?.snap ?? null });

  // "Get caught up": recap the delayed summary in the sport's terms via the serve
  // bus; requestRecap handles the nothing-yet / no-agent / timeout cases.
  const runCatchup = async (): Promise<string> => {
    const at = snapshotAtDelay(buffer, delaySec, Date.now());
    if (!at || !current) return "Open a game first — nothing to catch up on yet.";
    if (!ai) return `No recap voice for ${cfg.label}.`;
    const res = await requestRecap(catchupInput(ai, current, at.summary), { maxChars: 600 });
    return res.ok ? res.recap : res.message;
  };

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
      if (ticks % 5 === 0) serving = await isServing().catch(() => false);
      if (current && ticks % 5 === 0) {
        try {
          const summary = await getGameSummary(cfg.league, current.id, 5_000);
          if (summary) {
            buffer.push({ t: Date.now(), data: { snap: snapshotOf(spec, summary), summary } });
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
        } else if (msg.fn === "catchup") {
          const text = await runCatchup();
          session?.send("Runtime.evaluate", { expression: "window.__sb&&window.__sb.catchupResult(" + JSON.stringify(text) + ")" }).catch(() => {});
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
    const side = { id: "", name: "", score: "0", linescores: [], record: "", stats: [], leaders: [], goalies: [] };
    const empty: EspnGameSummary = {
      state: "pre",
      detail: "smoke",
      period: 1,
      away: { ...side, abbreviation: "AWY" },
      home: { ...side, abbreviation: "HOM" },
      plays: [],
    };
    const game = snapshotOf(spec, empty);
    const all = Object.fromEntries(spec.panels.map(([k]) => [k, true]));
    // Stat panels render a titled section; "Get caught up" its button.
    const titles = spec.panels.filter(([k]) => !SPECIAL_PANELS.includes(k)).map(([, label]) => label).concat(["Get caught up"]);
    const check =
      "(function(){window.__sb.update(" + JSON.stringify({ panels: all, delay: 0, game }) + ");" +
      "var s=document.getElementById('sb-stats'),b=document.getElementById('sb-body');" +
      "if(!document.getElementById('sb-gear')||!s||s.style.display==='none'||!b)return false;" +
      "var t=s.textContent;return " + JSON.stringify(titles) + ".every(function(x){return t.indexOf(x)>=0;})&&t.indexOf('AWY 0 @ HOM 0')>=0;})()";
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
