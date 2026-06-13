// Live-stats overlay injected onto the stream page via CDP. Minimal by default —
// a compact strip (score · clock · win% · gear) — and the user opts into panels
// via a settings modal (gear), so it never becomes screen clutter. Follows the
// match you open, buffers ESPN snapshots and renders the one from `delay`s ago
// (calibrated to your stream to avoid spoilers). Panel choices + delay persist.

import { c } from "./ansi.ts";
import { findEvent, getHeadToHead, getLiveMatch, getEvents, type EspnEvent } from "./espn.ts";
import { getStreamDelay, setStreamDelay, getOverlayPanels, setOverlayPanel, OVERLAY_PANEL_DEFAULTS } from "./config.ts";
import { freePort, attachToPage, type CdpSession } from "./cdp.ts";
import { spawnStreamWindow } from "./stream.ts";
import { detectFromTitle, searchTerms } from "./match-detect.ts";

const BOOTSTRAP = [
  "(function(){",
  "if(window.__sbInit)return;window.__sbInit=true;",
  "var D=" + JSON.stringify(OVERLAY_PANEL_DEFAULTS) + ";", // panel defaults — single source of truth (config.ts)
  "function esc(s){var d=document.createElement('div');d.appendChild(document.createTextNode(String(s==null?'':s)));return d.innerHTML;}",
  "function row(label,a,b){return '<div style=\"display:flex;justify-content:space-between;margin-top:3px\"><span>'+esc(a)+'</span><span style=\"color:#8b949e\">'+label+'</span><span>'+esc(b)+'</span></div>';}",
  "function show(id,on){var e=document.getElementById(id);if(e)e.style.display=on?'':'none';}",
  "function fmtCd(ms){var s=Math.max(0,Math.floor(ms/1000));return 'in '+Math.floor(s/60)+':'+('0'+(s%60)).slice(-2);}",
  "function statusCell(state,kickoff,detail,id){if(state==='in')return '<span data-watch=\"'+esc(id)+'\" style=\"color:#3fb950;cursor:pointer;font-weight:700\">\\u25cf LIVE \\u25b6</span>';if(state==='pre'){var k=Date.parse(kickoff||'');var ms=k-Date.now();if(k&&ms>0&&ms<=1800000)return '<span style=\"color:#d29922;font-size:11px\">'+fmtCd(ms)+'</span>';if(k)return '<span style=\"color:#8b949e;font-size:11px\">'+esc(new Date(k).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</span>';}return '<span style=\"color:#8b949e;font-size:11px\">'+esc(detail||'')+'</span>';}",
  "function cb(key,label,checked,disabled){return '<label style=\"display:flex;align-items:center;gap:8px;padding:3px 0;'+(disabled?'opacity:.4':'cursor:pointer')+'\"><input type=\"checkbox\" data-k=\"'+key+'\"'+(checked?' checked':'')+(disabled?' disabled':'')+'>'+esc(label)+(disabled?' (soon)':'')+'</label>';}",
  "function mk(){",
  "  if(!document.body){return setTimeout(mk,200);}",
  "  if(document.getElementById('sb-panel'))return;",
  "  var p=document.createElement('div');p.id='sb-panel';",
  "  p.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;width:258px;padding:11px 13px;border-radius:10px;background:rgba(12,12,16,0.94);color:#e6edf3;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,0.6);user-select:none';",
  "  p.innerHTML='"
  + "<div id=\"sb-strip\" style=\"display:flex;align-items:baseline;gap:8px;cursor:move\">"
  + "<b id=\"sb-score\" style=\"flex:1\">…</b>"
  + "<span id=\"sb-clock\" style=\"color:#58a6ff;font-size:11px\"></span>"
  + "<span id=\"sb-wp\" style=\"color:#3fb950;font-size:11px;font-weight:700\"></span>"
  + "<button id=\"sb-gear\" title=\"settings\" style=\"background:none;border:none;color:#8b949e;cursor:pointer;font-size:14px;padding:0\">⚙</button></div>"
  + "<div id=\"sb-pl-winprob\" style=\"margin-top:6px;display:none\"></div>"
  + "<div id=\"sb-pl-stats\" style=\"margin-top:6px;display:none\"></div>"
  + "<div id=\"sb-pl-odds\" style=\"margin-top:6px;color:#8b949e;font-size:11px;display:none\"></div>"
  + "<div id=\"sb-pl-h2h\" style=\"display:none\"><button id=\"sb-h2h\" style=\"margin-top:10px;width:100%;padding:6px;background:#1f6feb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px\">Head-to-head</button><div id=\"sb-h2h-out\" style=\"margin-top:8px\"></div></div>"
  + "<div id=\"sb-set\" style=\"display:none;margin-top:10px;border-top:1px solid #21262d;padding-top:8px\">"
  + "<div style=\"color:#8b949e;font-size:11px;margin-bottom:4px\">Show panels</div><div id=\"sb-cbs\"></div>"
  + "<div style=\"margin-top:9px;font-size:11px\"><div style=\"display:flex;justify-content:space-between;color:#8b949e\"><span>delay</span><span id=\"sb-delay\">0s</span></div><input id=\"sb-slider\" type=\"range\" min=\"0\" max=\"300\" step=\"5\" value=\"0\" style=\"width:100%;margin-top:4px;accent-color:#1f6feb\"></div>"
  + "<div style=\"color:#555;font-size:10px;margin-top:6px\">delay trails your stream to avoid spoilers (up to 5 min)</div></div>"
  + "<div id=\"sb-fresh\" style=\"color:#555;font-size:10px;margin-top:8px;text-align:right\"></div>';",
  "  document.body.appendChild(p);",
  "  var strip=document.getElementById('sb-strip'),drag=null;",
  "  strip.addEventListener('mousedown',function(e){if(e.target.id==='sb-gear')return;drag={x:e.clientX,y:e.clientY,l:p.offsetLeft,t:p.offsetTop};});",
  "  window.addEventListener('mousemove',function(e){if(!drag)return;p.style.left=(drag.l+e.clientX-drag.x)+'px';p.style.top=(drag.t+e.clientY-drag.y)+'px';p.style.right='auto';});",
  "  window.addEventListener('mouseup',function(){drag=null;});",
  "  function call(o){if(window.__sbCall)window.__sbCall(JSON.stringify(o));}",
  "  document.getElementById('sb-gear').addEventListener('click',function(){var s=document.getElementById('sb-set');s.style.display=s.style.display==='none'?'':'none';});",
  "  document.getElementById('sb-cbs').innerHTML=cb('stats','Possession / shots',!!D.stats,false)+cb('winprob','Win-probability breakdown',!!D.winprob,false)+cb('odds','Odds line',!!D.odds,false)+cb('h2h','Head-to-head',!!D.h2h,false)+cb('events','Live events',false,true)+cb('scores','Other live scores',false,true)+cb('ai','AI read',false,true);",
  "  document.getElementById('sb-cbs').addEventListener('change',function(e){if(e.target&&e.target.dataset.k)call({fn:'pref',key:e.target.dataset.k,on:e.target.checked});});",
  "  document.getElementById('sb-slider').addEventListener('input',function(e){call({fn:'delay',set:Number(e.target.value)});});",
  "  p.addEventListener('click',function(e){var t=e.target;while(t&&t!==p){if(t.getAttribute&&t.getAttribute('data-watch')!==null){call({fn:'watch',id:t.getAttribute('data-watch')});return;}t=t.parentElement;}});",
  "  document.getElementById('sb-h2h').addEventListener('click',function(){document.getElementById('sb-h2h').textContent='Loading…';call({fn:'headToHead'});});",
  "}",
  "window.__sb={",
  "  update:function(d){mk();var P=d.panels||{};",
  "    if(d.mode==='today'){document.getElementById('sb-score').textContent='Today';document.getElementById('sb-clock').textContent=(d.games||[]).length+' matches';document.getElementById('sb-wp').textContent='';['sb-pl-winprob','sb-pl-stats','sb-pl-odds','sb-pl-h2h'].forEach(function(i){show(i,false);});var st=document.getElementById('sb-pl-stats');show('sb-pl-stats',true);var g=d.games||[],h='';for(var i=0;i<g.length;i++){h+='<div style=\"display:flex;justify-content:space-between;gap:8px;padding:2px 0\"><span>'+esc(g[i].home)+' '+esc(g[i].hs)+' – '+esc(g[i].as)+' '+esc(g[i].away)+'</span>'+statusCell(g[i].state,g[i].kickoff,g[i].detail,g[i].id)+'</div>';}st.innerHTML=h||'<span style=\"color:#8b949e\">no matches today</span>';return;}",
  "    document.getElementById('sb-score').textContent=d.home+' '+d.homeScore+' – '+d.awayScore+' '+d.away;document.getElementById('sb-clock').innerHTML=statusCell(d.state,d.kickoff,d.detail,d.id);",
  "    var wpEl=document.getElementById('sb-wp');if(d.winProb){var fav=d.winProb[0]>=d.winProb[2]?d.home:d.away,fp=Math.max(d.winProb[0],d.winProb[2]);wpEl.textContent=fav+' '+fp+'%';}else wpEl.textContent='';",
  "    show('sb-pl-stats',!!P.stats);show('sb-pl-winprob',!!P.winprob&&!!d.winProb);show('sb-pl-odds',!!P.odds);show('sb-pl-h2h',!!P.h2h);",
  "    if(P.stats){var s='';if(d.possession)s+=row('poss %',d.possession[0],d.possession[1]);if(d.shots)s+=row('shots',d.shots[0],d.shots[1]);if(d.onTarget)s+=row('on target',d.onTarget[0],d.onTarget[1]);document.getElementById('sb-pl-stats').innerHTML=s;}",
  "    if(P.winprob&&d.winProb){document.getElementById('sb-pl-winprob').innerHTML=row('win %',d.home+' '+d.winProb[0]+'%','')+row('draw',d.winProb[1]+'%','')+row('win %','',d.away+' '+d.winProb[2]+'%');}",
  "    if(P.odds)document.getElementById('sb-pl-odds').textContent=d.oddsLine||'odds n/a';",
  "    var dl=document.getElementById('sb-delay'),sl=document.getElementById('sb-slider'),dv=d.delay||0;if(dl)dl.textContent=dv>=60?(Math.floor(dv/60)+'m '+(dv%60)+'s'):(dv+'s');if(sl&&document.activeElement!==sl)sl.value=dv;",
  "    var cbs=document.querySelectorAll('#sb-cbs input[data-k]');for(var i=0;i<cbs.length;i++){var k=cbs[i].dataset.k;if(P[k]!==undefined&&!cbs[i].disabled)cbs[i].checked=!!P[k];}",
  "    var fr=document.getElementById('sb-fresh');if(fr)fr.textContent=d.at?'⟳ '+d.at:'';},",
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
          id: e.id,
          home: home?.abbreviation ?? "?",
          away: away?.abbreviation ?? "?",
          hs: home?.score ?? "0",
          as: away?.score ?? "0",
          detail: e.detail,
          state: e.state,
          kickoff: e.date,
        };
      });
  } catch {
    /* ignore */
  }
  return { mode: "today", games };
}

// Auto-open the game over the existing ui-leaf CDP session (no separate
// browser), in two phases: (1) find the game's tile on the hub by team name
// (any language) and click it to route there; (2) some providers (Fubo) land on
// a program-details page with a "Watch live" CTA, others (Peacock) go straight
// to the player — so click a Watch/Play CTA if present and finish once a
// <video> is actually playing. Returns true once routed (best-effort).
async function tryDeepLink(session: CdpSession, ev: EspnEvent): Promise<boolean> {
  const { home, away } = sides(ev);
  const A = searchTerms(home?.name ?? "", home?.abbreviation ?? "");
  const B = searchTerms(away?.name ?? "", away?.abbreviation ?? "");
  // Scan the hub for the game's tile and click it. The matcher must be picky:
  // a matchup string also appears on non-navigable headings (Fubo's program
  // page title) and inside huge list containers with a delegated onclick
  // (Peacock's rail). So we (1) require a real click affordance, (2) reject
  // ancestors bigger than the viewport (the rail/list, not a card), and
  // (3) among all matches pick the smallest, link-like target — then click it
  // WITHOUT scrollIntoView (the jump was the visible bug; SPA handlers fire
  // off-screen anyway).
  const js =
    "(function(A,B){" +
    "function isLink(n){return n.tagName==='A'||n.getAttribute('role')==='link';}" +
    "function aff(n){return isLink(n)||n.tagName==='BUTTON'||n.getAttribute('role')==='button'||!!n.onclick;}" +
    "function clk(el){for(var n=el;n&&n!==document.body;n=n.parentElement){if(aff(n)){var r=n.getBoundingClientRect();if(r.width*r.height>=400&&r.height<=2*innerHeight)return n;}}return null;}" + // a card, not the giant rail/list container
    "function split(t){var s=[' v. ',' vs ',' v ',' versus '];for(var k=0;k<s.length;k++){var i=t.indexOf(s[k]);if(i>0)return [t.slice(0,i),t.slice(i+s[k].length)];}return null;}" +
    "function inAny(s,arr){for(var j=0;j<arr.length;j++)if(s.indexOf(arr[j])>=0)return true;return false;}" +
    "var all=document.querySelectorAll('*'),best=null;for(var i=0;i<all.length;i++){var el=all[i];if(el.children.length>3)continue;var t=(el.innerText||'').replace(/\\s+/g,' ').trim().toLowerCase();if(!t||t.length>44)continue;var sp=split(t);if(!sp)continue;" +
    "if(!((inAny(sp[0],A)&&inAny(sp[1],B))||(inAny(sp[0],B)&&inAny(sp[1],A))))continue;" +
    "var c=clk(el);if(!c)continue;var r=c.getBoundingClientRect();var sc=(isLink(c)?0:1)*1e9+r.width*r.height;" + // prefer real links, then the smallest target (a card, not the rail)
    "if(!best||sc<best.sc)best={el:c,sc:sc};}" +
    "if(best){best.el.click();return true;}return false;" +
    "})(" + JSON.stringify(A) + "," + JSON.stringify(B) + ")";

  // Phase 2: enter the player and start it. Once a viewport-filling <video>
  // exists we are IN the player — and these DRM players (Peacock/Fubo) ignore a
  // scripted video.play() (their state machine re-pauses the raw element), so
  // the only thing that starts them is a *trusted* click on their Play control.
  // We therefore return the Play button's coordinates and let the caller fire a
  // real Input.dispatchMouseEvent (synthetic .click() doesn't satisfy the
  // autoplay user-gesture requirement). CRITICAL: we hand back those coords ONLY
  // while v.paused — so we never click while playing (which would toggle pause).
  // The Play control is identified by aria-label "Play"/"Reproducir" (present
  // only when paused). On a non-player page (Fubo's program-details) we instead
  // click the "Watch live" CTA, matched by visible innerText so the player's
  // 48px aria-label-only icon controls can't match.
  // Returns {s:'playing'|'wait'|'clicked'|'none'} or {s:'play',x,y}.
  const watchJs =
    "(function(){" +
    "var v=document.querySelector('video');" +
    "var big=v&&(v.getBoundingClientRect().width*v.getBoundingClientRect().height>=0.4*innerWidth*innerHeight);" +
    "if(big){" +
    "  if(!v.paused)return JSON.stringify({s:'playing'});" + // already playing — never touch it
    "  var c=document.querySelectorAll('button,[role=button]');" +
    "  for(var i=0;i<c.length;i++){var el=c[i];var al=((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).trim().toLowerCase();" +
    "    if(/^(play|reproducir|reanudar)\\b/.test(al)){var rr=el.getBoundingClientRect();if(rr.width*rr.height>=100)return JSON.stringify({s:'play',x:Math.round(rr.left+rr.width/2),y:Math.round(rr.top+rr.height/2)});}}" +
    "  return JSON.stringify({s:'wait'});" + // paused but no Play control found yet — keep waiting
    "}" +
    "var b=document.querySelectorAll('button,a,[role=button],[role=link]');" +
    "for(var i=0;i<b.length;i++){var el=b[i];var t=(el.innerText||'').toLowerCase();" + // innerText only — not aria-label, so icon controls don't match
    "if(!/(watch live|watch now|ver en vivo|ver ahora)/.test(t))continue;" +
    "var r=el.getBoundingClientRect();if(r.width*r.height<400)continue;" +
    "el.click();return JSON.stringify({s:'clicked'});}" +
    "return JSON.stringify({s:'none'});" +
    "})()";

  const evalValue = async (expression: string): Promise<unknown> => {
    try {
      const r = await session.send("Runtime.evaluate", { expression, returnByValue: true });
      return r?.result?.result?.value;
    } catch {
      return undefined; // page navigating
    }
  };

  // A real (trusted) click — required to satisfy the player's autoplay gesture
  // check, which a scripted element.click() does not.
  const trustedClick = async (x: number, y: number) => {
    try {
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    } catch {
      /* page navigating */
    }
  };

  // Phase 1 — click the matchup tile to route to the game's page.
  let routed = false;
  for (let i = 0; i < 8 && !routed; i++) {
    await new Promise((r) => setTimeout(r, 1500)); // hub SPA lazy-loads — keep trying
    if ((await evalValue(js)) === true) routed = true;
  }
  if (!routed) return false;

  // Phase 2 — enter the player (Fubo needs a "Watch live" click; Peacock routes
  // straight in) and start it; finish once the video is actually playing.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    let r: { s?: string; x?: number; y?: number } = {};
    try {
      r = JSON.parse((await evalValue(watchJs)) as string);
    } catch {
      continue; // page navigating / no result this tick
    }
    if (r.s === "playing") return true;
    if (r.s === "play" && typeof r.x === "number" && typeof r.y === "number") await trustedClick(r.x, r.y);
  }
  return true; // routed to the game even if we couldn't confirm <video> playback
}

/** Launch the stream with the configurable, page-following, delay-calibratable overlay. Blocks until closed. */
export async function runOverlayStream(
  url: string,
  label: string,
  ev: EspnEvent,
  opts: { deepLink?: boolean; windowSize?: { width: number; height: number } } = {},
): Promise<void> {
  const providerKey = label.toLowerCase();
  const port = await freePort();
  const win = await spawnStreamWindow(url, label, { debugPort: port, windowSize: opts.windowSize });
  if (!win) {
    process.exitCode = 1;
    return;
  }

  console.log(c.bold(c.cyan(`⚽ Opening ${label} with live overlay`)) + c.dim(`  ${url}`));
  console.log(c.dim("Minimal strip by default — click the ⚙ in the panel to choose what shows + sync the delay."));

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

  // Dynamically open the game: find its tile on the hub and click it (the SPA
  // routes to the match). Fire-and-forget — the title poll then follows it.
  if (session && opts.deepLink) {
    void tryDeepLink(session, ev).then((ok) => {
      if (!ok) console.log(c.dim(`Couldn't auto-open the game — open ${ev.name} in ${label} and the overlay will follow.`));
    });
  }

  let currentEv = ev;
  let mode: "match" | "today" = "match";
  let delaySec = (await getStreamDelay(providerKey)) ?? 0;
  let panels = await getOverlayPanels(providerKey);
  let buffer: { t: number; data: Record<string, unknown> }[] = [];
  let lastTitle = "";
  let ticks = 0;
  let running = false;

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

  const renderDelayed = () => {
    if (!buffer.length) return;
    const cutoff = Date.now() - delaySec * 1000;
    let chosen = buffer[0]!;
    for (const b of buffer) if (b.t <= cutoff) chosen = b;
    push({ ...chosen.data, delay: delaySec, panels });
  };

  const tick = async () => {
    if (running || !session) return;
    running = true;
    try {
      const title = await readTitle();
      if (title !== lastTitle) {
        lastTitle = title;
        const ctx = detectFromTitle(title);
        if (ctx.kind === "today") {
          mode = "today";
        } else {
          if (ctx.kind === "match") {
            try {
              const found = await findEvent(ctx.teams);
              if (found && found.id !== currentEv.id) {
                currentEv = found;
                buffer = [];
              }
            } catch {
              /* keep current */
            }
          }
          mode = "match";
        }
      }

      if (mode === "today") {
        push({ ...(await todaySnapshot()), panels });
        ticks++;
        return;
      }

      if (ticks % 5 === 0) {
        try {
          const live = await getLiveMatch(currentEv.id);
          if (live) {
            const { home, away } = sides(currentEv);
            buffer.push({
              t: Date.now(),
              data: {
                mode: "match",
                id: currentEv.id,
                home: live.homeAbbr || home?.abbreviation || "?",
                away: live.awayAbbr || away?.abbreviation || "?",
                homeScore: live.homeScore,
                awayScore: live.awayScore,
                detail: live.detail,
                state: live.state,
                kickoff: live.kickoff,
                possession: live.possession,
                shots: live.shots,
                onTarget: live.onTarget,
                winProb: live.winProb,
                oddsLine: live.oddsLine,
                at: new Date().toLocaleTimeString(),
              },
            });
            buffer = buffer.filter((b) => Date.now() - b.t <= 330_000); // keep > 5 min so a max delay has data
          }
        } catch {
          /* transient */
        }
      }
      renderDelayed();
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
        if (msg.fn === "headToHead") {
          const h2h = await getHeadToHead(currentEv.id);
          session?.send("Runtime.evaluate", { expression: "window.__sb&&window.__sb.result(" + JSON.stringify(h2h) + ")" }).catch(() => {});
        } else if (msg.fn === "delay") {
          const next = typeof msg.set === "number" ? msg.set : delaySec + (Number(msg.d) || 0);
          delaySec = Math.min(300, Math.max(0, Math.round(next))); // 0–5 min
          await setStreamDelay(providerKey, delaySec);
          renderDelayed();
        } else if (msg.fn === "watch") {
          const target = msg.id ? ((await getEvents()).find((e) => e.id === String(msg.id)) ?? currentEv) : currentEv;
          void tryDeepLink(session!, target);
        } else if (msg.fn === "pref" && typeof msg.key === "string") {
          panels = { ...panels, [msg.key]: !!msg.on };
          await setOverlayPanel(providerKey, msg.key, !!msg.on);
          renderDelayed();
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
