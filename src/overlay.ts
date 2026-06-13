// Live-stats overlay injected onto the stream page via CDP (the path that
// survives Chrome 149's --load-extension lockdown). sportsball launches the
// stream window with ui-leaf's debugPort (#66), attaches over CDP, injects a
// panel onto the provider page, and keeps it in sync with the page: it reads
// document.title each tick to detect which match you're on (provider-agnostic —
// Spanish on Peacock, English on Fubo) and follows it; on the WC hub it shows
// today's matches. Head-to-head is answered over a CDP binding.

import { c } from "./ansi.ts";
import { findEvent, getHeadToHead, getMatchStats, getEvents, type EspnEvent } from "./espn.ts";
import { freePort, attachToPage, type CdpSession } from "./cdp.ts";
import { spawnStreamWindow } from "./stream.ts";
import { detectFromTitle } from "./match-detect.ts";

// Injected into every document. Builds a draggable panel and exposes
// window.__sb.update()/result(); the head-to-head button calls window.__sbCall
// (a CDP binding the host listens on). Idempotent. update() handles two modes:
// a single match, or today's list (mode:"today").
const BOOTSTRAP = [
  "(function(){",
  "if(window.__sbInit)return;window.__sbInit=true;",
  "function mk(){",
  "  if(!document.body){return setTimeout(mk,200);}",
  "  if(document.getElementById('sb-panel'))return;",
  "  var p=document.createElement('div');p.id='sb-panel';",
  "  p.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;width:250px;padding:12px 14px;border-radius:10px;background:rgba(12,12,16,0.94);color:#e6edf3;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,0.6);user-select:none';",
  "  p.innerHTML='<div id=\"sb-hd\" style=\"display:flex;justify-content:space-between;align-items:baseline;cursor:move\"><b id=\"sb-score\">…</b><span id=\"sb-detail\" style=\"color:#58a6ff;font-size:11px\"></span></div><div id=\"sb-stats\" style=\"margin-top:6px\"></div><button id=\"sb-h2h\" style=\"margin-top:10px;width:100%;padding:6px;background:#1f6feb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px\">Head-to-head</button><div id=\"sb-h2h-out\" style=\"margin-top:8px\"></div><div id=\"sb-fresh\" style=\"color:#555;font-size:10px;margin-top:8px;text-align:right\"></div>';",
  "  document.body.appendChild(p);",
  "  var hd=document.getElementById('sb-hd'),drag=null;",
  "  hd.addEventListener('mousedown',function(e){drag={x:e.clientX,y:e.clientY,l:p.offsetLeft,t:p.offsetTop};});",
  "  window.addEventListener('mousemove',function(e){if(!drag)return;p.style.left=(drag.l+e.clientX-drag.x)+'px';p.style.top=(drag.t+e.clientY-drag.y)+'px';p.style.right='auto';});",
  "  window.addEventListener('mouseup',function(){drag=null;});",
  "  document.getElementById('sb-h2h').addEventListener('click',function(){var b=document.getElementById('sb-h2h');b.textContent='Loading…';if(window.__sbCall)window.__sbCall(JSON.stringify({fn:'headToHead'}));});",
  "}",
  "function esc(s){var d=document.createElement('div');d.appendChild(document.createTextNode(String(s==null?'':s)));return d.innerHTML;}",
  "function row(label,a,b){return '<div style=\"display:flex;justify-content:space-between;margin-top:3px\"><span>'+esc(a)+'</span><span style=\"color:#8b949e\">'+label+'</span><span>'+esc(b)+'</span></div>';}",
  "window.__sb={",
  "  update:function(d){mk();var s=document.getElementById('sb-score'),dt=document.getElementById('sb-detail'),st=document.getElementById('sb-stats'),btn=document.getElementById('sb-h2h'),out=document.getElementById('sb-h2h-out');if(!s)return;",
  "    if(d.mode==='today'){s.textContent='Today';var g=d.games||[];dt.textContent=g.length+' matches';if(btn)btn.style.display='none';if(out)out.innerHTML='';var h='';for(var i=0;i<g.length;i++){h+='<div style=\"display:flex;justify-content:space-between;padding:2px 0\"><span>'+esc(g[i].home)+' '+esc(g[i].hs)+' – '+esc(g[i].as)+' '+esc(g[i].away)+'</span><span style=\"color:#8b949e;font-size:11px\">'+esc(g[i].detail||'')+'</span></div>';}st.innerHTML=h||'<span style=\"color:#8b949e\">no matches today</span>';return;}",
  "    if(btn)btn.style.display='';s.textContent=d.home+' '+d.homeScore+' – '+d.awayScore+' '+d.away;dt.textContent=d.detail||'';var h2='';if(d.possession)h2+=row('poss %',d.possession[0],d.possession[1]);if(d.shots)h2+=row('shots',d.shots[0],d.shots[1]);if(d.onTarget)h2+=row('on target',d.onTarget[0],d.onTarget[1]);st.innerHTML=h2;var fr=document.getElementById('sb-fresh');if(fr)fr.textContent=d.at?'⟳ updated '+d.at:'';},",
  "  result:function(d){mk();var o=document.getElementById('sb-h2h-out'),b=document.getElementById('sb-h2h');if(b)b.textContent='Head-to-head';if(!o)return;var g=(d&&d.games)||[];var h='<div style=\"color:#8b949e;font-size:11px;margin-bottom:4px\">Past meetings — '+esc((d&&d.team)||'')+'</div>';if(!g.length)h+='<div style=\"color:#8b949e\">none found</div>';for(var i=0;i<g.length;i++){var col=g[i].result==='W'?'#3fb950':g[i].result==='L'?'#f85149':'#8b949e';h+='<div style=\"display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #21262d\"><span style=\"color:#8b949e;width:5.5rem\">'+esc(g[i].date)+'</span><b style=\"width:2.5rem\">'+esc(g[i].score)+'</b><span style=\"color:'+col+'\">'+esc(g[i].result)+'</span></div>';}o.innerHTML=h;}",
  "};",
  "mk();",
  "})();",
].join("\n");

function sides(ev: EspnEvent) {
  return {
    home: ev.competitors.find((t) => t.homeAway === "home"),
    away: ev.competitors.find((t) => t.homeAway === "away"),
  };
}

async function matchSnapshot(ev: EspnEvent): Promise<Record<string, unknown>> {
  const { home, away } = sides(ev);
  const out: Record<string, unknown> = {
    mode: "match",
    home: home?.abbreviation ?? "?",
    away: away?.abbreviation ?? "?",
    homeScore: home?.score ?? "0",
    awayScore: away?.score ?? "0",
    detail: ev.detail,
    at: new Date().toLocaleTimeString(),
  };
  try {
    // Short TTL so a live overlay refreshes close to ESPN's own cadence (the floor).
    const teams = await getMatchStats(ev.id, 8_000);
    const byAbbr = (a?: string) => teams.find((t) => t.abbreviation === a);
    const h = byAbbr(home?.abbreviation) ?? teams[0];
    const a = byAbbr(away?.abbreviation) ?? teams[1];
    const stat = (t: typeof h, n: string) => t?.stats.find((s) => s.name === n)?.value ?? "—";
    if (h && a) {
      out.possession = [stat(h, "possessionPct"), stat(a, "possessionPct")];
      out.shots = [stat(h, "totalShots"), stat(a, "totalShots")];
      out.onTarget = [stat(h, "shotsOnTarget"), stat(a, "shotsOnTarget")];
    }
  } catch {
    /* pre-match — score only */
  }
  return out;
}

async function todaySnapshot(): Promise<Record<string, unknown>> {
  const today = new Date().toLocaleDateString();
  let games: unknown[] = [];
  try {
    const evs = await getEvents();
    games = evs
      .filter((e) => new Date(e.date).toLocaleDateString() === today)
      .map((e) => {
        const { home, away } = sides(e);
        return {
          home: home?.abbreviation ?? "?",
          away: away?.abbreviation ?? "?",
          hs: home?.score ?? "0",
          as: away?.score ?? "0",
          detail: e.detail,
        };
      });
  } catch {
    /* ignore */
  }
  return { mode: "today", games };
}

/** Launch the stream window with CDP and run the smart, page-following overlay. Blocks until closed. */
export async function runOverlayStream(url: string, label: string, ev: EspnEvent): Promise<void> {
  const port = await freePort();
  const win = await spawnStreamWindow(url, label, { debugPort: port });
  if (!win) {
    process.exitCode = 1;
    return;
  }

  console.log(c.bold(c.cyan(`⚽ Opening ${label} with live overlay`)) + c.dim(`  ${url}`));
  console.log(c.dim("The panel follows whatever match you open. Close the window (or Ctrl-C) when done."));

  let session: CdpSession | undefined;
  try {
    session = await attachToPage(port);
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    await session.send("Runtime.addBinding", { name: "__sbCall" });
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOTSTRAP });
    await session.send("Runtime.evaluate", { expression: BOOTSTRAP });
  } catch (e) {
    console.error(c.yellow("Overlay unavailable (CDP attach failed) — stream is still open."));
    console.error(c.dim(e instanceof Error ? e.message : String(e)));
  }

  let currentEv = ev; // the match the panel is tracking; follows the page
  const push = (data: unknown) =>
    session?.send("Runtime.evaluate", { expression: "window.__sb&&window.__sb.update(" + JSON.stringify(data) + ")" }).catch(() => {});

  const readTitle = async (): Promise<string> => {
    try {
      const r = await session?.send("Runtime.evaluate", { expression: "document.title", returnByValue: true });
      return r?.result?.result?.value ?? "";
    } catch {
      return "";
    }
  };

  // Two cadences, decoupled: detect the page fast (cheap title read, act only on
  // change) and refresh stats slowly (ESPN data changes ~per minute).
  let mode: "match" | "today" = "match";
  let lastTitle = "";
  let ticks = 0;
  let running = false; // re-entrancy guard so a slow fetch can't pile up ticks
  const STAT_REFRESH_TICKS = 8; // at 1s/tick → ~8s, near ESPN's refresh floor

  const renderCurrent = async () => push(mode === "today" ? await todaySnapshot() : await matchSnapshot(currentEv));

  const tick = async () => {
    if (running || !session) return;
    running = true;
    try {
      const title = await readTitle();
      if (title !== lastTitle) {
        // Page changed — re-detect and re-render immediately.
        lastTitle = title;
        const ctx = detectFromTitle(title);
        if (ctx.kind === "today") {
          mode = "today";
        } else {
          if (ctx.kind === "match") {
            try {
              const found = await findEvent(ctx.teams);
              if (found) currentEv = found;
            } catch {
              /* keep current */
            }
          }
          mode = "match";
        }
        await renderCurrent();
      } else if (ticks % STAT_REFRESH_TICKS === 0) {
        // Same page — periodic stat/score refresh.
        await renderCurrent();
      }
      ticks++;
    } finally {
      running = false;
    }
  };

  if (session) {
    session.onEvent(async (method, params) => {
      if (method !== "Runtime.bindingCalled" || params?.name !== "__sbCall") return;
      try {
        const { fn } = JSON.parse(params.payload ?? "{}");
        if (fn === "headToHead") {
          const h2h = await getHeadToHead(currentEv.id);
          session?.send("Runtime.evaluate", {
            expression: "window.__sb&&window.__sb.result(" + JSON.stringify(h2h) + ")",
          }).catch(() => {});
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
