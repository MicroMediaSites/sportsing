// Deep-link into a game on a streaming provider's hub over an attached CDP
// session: click the game's tile, then enter the player and start it. Shared by
// `fifa watch` (overlay.ts) and `nba|nhl watch` (incl. the daemon's opens).

import type { CdpSession } from "./cdp.ts";

/** Preferred broadcast language for providers (Fubo) that carry both a Fox
 *  (English) and Telemundo (Spanish) airing of the same match. Consumed by the
 *  deep-link tile-scorer (AGT-543) and the post-landing warning (AGT-544). */
export type WatchLang = "english" | "spanish";

/**
 * Page-side `split(t)`: a lowercased tile title → its two sides, or null when
 * it isn't a matchup. Soccer hubs say "A v. B" / "A vs B"; Fubo's NBA/NHL tiles
 * say "Away at Home" ("denver nuggets at utah jazz"). Exported (as source) so
 * tests can evaluate the exact function the page runs.
 */
/** A game to deep-link into: its teams' full names as the hub shows them. */
export interface DeepLinkGame {
  home: string;
  away: string;
  /** For messages, e.g. "Denver Nuggets at Utah Jazz". */
  name: string;
}

/**
 * Tile search terms for an NBA/NHL team: the full name only. Fubo's league
 * tiles spell both teams out ("Denver Nuggets at Utah Jazz"), and the short
 * forms would mis-match — 2-letter abbreviations (LA, NO) are substrings of
 * other names, and the FIFA aliases map DEN to Denmark.
 */
export function leagueTileTerms(name: string): string[] {
  const n = name.replace(/\s+/g, " ").trim().toLowerCase();
  return n ? [n] : [];
}

export const JS_SPLIT_MATCHUP =
  "function split(t){var s=[' v. ',' vs. ',' vs ',' v ',' versus ',' at ',' @ '];for(var k=0;k<s.length;k++){var i=t.indexOf(s[k]);if(i>0)return [t.slice(0,i),t.slice(i+s[k].length)];}return null;}";

// ---------------------------------------------------------------------------
// Paramount+ (AGT-1716). Its league hub (/shows/serie-a/) has a "live events"
// grid of <article class="live-event"> tiles, each with a real <a class="link">
// to /live-tv/stream/<league>/<uuid>, so we skip the generic click-a-tile path:
// extract {title, href, live} per tile in-page, match the teams in Node (pure,
// unit-tested), and navigate straight to the href.
// NOT in scope yet: Prime Video (League Pass channel) and Peacock live-game
// pages — add their matchers here once those DOMs are captured.
// ---------------------------------------------------------------------------

/** One Paramount+ live-events tile, as extracted in-page. */
export interface ParamountTile {
  title: string; // "Cagliari vs. Juventus" (Home vs. Away, full club names)
  href: string;
  live: boolean; // tile carries the Live badge / event-time--live
}

/** What the in-page extractor returns. */
export interface ParamountPage {
  path: string;
  tiles: ParamountTile[];
  /** href of the hero "WATCH LIVE" button, if any. */
  hero: string | null;
}

/** Page-side extractor (evaluated over CDP; returns a JSON string). */
export const JS_PARAMOUNT_EXTRACT =
  "(function(){var t=[],a=document.querySelectorAll('article.live-event');" +
  "for(var i=0;i<a.length;i++){var l=a[i].querySelector('a.link'),s=a[i].querySelector('span.title');if(!l||!s)continue;" +
  "t.push({title:(s.textContent||'').replace(/\\s+/g,' ').trim(),href:l.getAttribute('href')||'',live:!!a[i].querySelector('.live-icon-copy,.event-time--live')});}" +
  "var h=null,b=document.querySelectorAll('.hero__slide .cta-box a.button');" +
  "for(var j=0;j<b.length;j++){if(/watch live/i.test(b[j].textContent||'')){h=b[j].getAttribute('href');break;}}" +
  "return JSON.stringify({path:location.pathname,tiles:t,hero:h});})()";

const CLUB_NOISE = new Set(["fc", "cf", "ac", "as", "sc", "afc", "ssc", "ss", "us", "ud", "cd", "calcio"]);
const CLUB_ALIASES: Record<string, string> = { psg: "paris saint germain", "paris sg": "paris saint germain" };

/** Lowercase, strip accents/punctuation/club-prefix noise ("AS Roma" → "roma"). */
export function normalizeClub(name: string): string {
  const n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const kept = n.split(" ").filter((w) => w && !CLUB_NOISE.has(w)).join(" ");
  const k = kept || n;
  return CLUB_ALIASES[k] ?? k;
}

/** Tolerant club match: equal after normalising, or one contains the other
 *  ("Inter" ⊂ "Internazionale"); the shorter side needs ≥4 chars. */
export function clubMatches(tileSide: string, term: string): boolean {
  const a = normalizeClub(tileSide);
  const b = normalizeClub(term);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}

const uuidOf = (href: string): string => (/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i.exec(href)?.[1] ?? "").toLowerCase();

/**
 * Pure core: the URL to open for the game among the tiles, or null. A tile
 * matches when its title's two sides match the two teams (either order); a live
 * tile beats a non-live one. A non-live pick still defers to the hero WATCH LIVE
 * link, but only when that link's uuid is the matched tile's.
 */
export function pickParamountTarget(
  tiles: ParamountTile[],
  hero: string | null,
  A: string[],
  B: string[],
  base = "https://www.paramountplus.com",
): string | null {
  const any = (side: string, terms: string[]) => terms.some((t) => clubMatches(side, t));
  const hits = tiles.filter((t) => {
    if (!t.href) return false;
    const sp = /^(.+?)\s+(?:vs\.?|v\.?|versus|at|@)\s+(.+)$/i.exec(t.title.replace(/\s+/g, " ").trim());
    return !!sp && ((any(sp[1]!, A) && any(sp[2]!, B)) || (any(sp[1]!, B) && any(sp[2]!, A)));
  });
  const tile = hits.find((t) => t.live) ?? hits[0];
  if (!tile) return null;
  const id = uuidOf(tile.href);
  const href = !tile.live && hero && id && uuidOf(hero) === id ? hero : tile.href;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export const isParamountUrl = (u: string): boolean => /(^|\.)paramountplus\.com$/i.test(safeHost(u));
function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

// Auto-open the game over the existing ui-leaf CDP session (no separate
// browser), in two phases: (1) find the game's tile on the hub by team name
// (any language) and click it to route there; (2) some providers (Fubo) land on
// a program-details page with a "Watch live" CTA, others (Peacock) go straight
// to the player — so click a Watch/Play CTA if present and finish once a
// <video> is actually playing. Returns true once routed (best-effort).
export async function deepLinkGame(session: CdpSession, A: string[], B: string[], lang: WatchLang = "english"): Promise<boolean> {
  // Scan the hub for the game's tile and click it. The matcher must be picky:
  // a matchup string also appears on non-navigable headings (Fubo's program
  // page title) and inside huge list containers with a delegated onclick
  // (Peacock's rail). So we (1) require a real click affordance, (2) reject
  // ancestors bigger than the viewport (the rail/list, not a card), and
  // (3) among all matches pick the smallest, link-like target — then click it
  // WITHOUT scrollIntoView (the jump was the visible bug; SPA handlers fire
  // off-screen anyway).
  const js =
    "(function(A,B,W){" +
    "function isLink(n){return n.tagName==='A'||n.getAttribute('role')==='link';}" +
    "function aff(n){return isLink(n)||n.tagName==='BUTTON'||n.getAttribute('role')==='button'||!!n.onclick;}" +
    "function clk(el){for(var n=el;n&&n!==document.body;n=n.parentElement){if(aff(n)){var r=n.getBoundingClientRect();if(r.width*r.height>=400&&r.height<=2*innerHeight)return n;}}return null;}" + // a card, not the giant rail/list container
    JS_SPLIT_MATCHUP +
    "function inAny(s,arr){for(var j=0;j<arr.length;j++)if(s.indexOf(arr[j])>=0)return true;return false;}" +
    // Wanted-language preference (AGT-543): Fubo lists each game as two tiles (Fox/
    // English + Telemundo/Spanish); the cast is in the tile's program-footer-subtitle
    // — verified live on the hub in spike AGT-541 ("…• FOX Sports 1" vs "Copa Mundial
    // de la FIFA 2026"). Spanish checked first (a subtitle naming both wouldn't, but
    // be deterministic). Returns '' when undeterminable → no preference applied.
    "function langOf(c){var q=c.querySelector&&c.querySelector('[data-testid=program-footer-subtitle]');var s=((q&&q.textContent)||c.textContent||'').toLowerCase();if(/copa mundial|telemundo|tudn|universo|en espa/.test(s))return 'spanish';if(/\\bfox\\b|world cup/.test(s))return 'english';return '';}" +
    "var all=document.querySelectorAll('*'),best=null;for(var i=0;i<all.length;i++){var el=all[i];if(el.children.length>3)continue;var t=(el.innerText||'').replace(/\\s+/g,' ').trim().toLowerCase();if(!t||t.length>64)continue;var sp=split(t);if(!sp)continue;" +
    "if(!((inAny(sp[0],A)&&inAny(sp[1],B))||(inAny(sp[0],B)&&inAny(sp[1],A))))continue;" +
    "var c=clk(el);if(!c)continue;var r=c.getBoundingClientRect();" +
    // language term dominates (1e12) so the wanted-cast tile beats the other-cast tile
    // of the same match; an unknown-language tile isn't penalised (preserves behaviour
    // when only one airing exists or no signal is present). Then prefer links, then area.
    "var lg=langOf(c);var langPen=(lg&&lg!==W)?1:0;var sc=langPen*1e12+(isLink(c)?0:1)*1e9+r.width*r.height;" +
    "if(!best||sc<best.sc)best={el:c,sc:sc};}" +
    "if(best){best.el.click();return true;}return false;" +
    "})(" + JSON.stringify(A) + "," + JSON.stringify(B) + "," + JSON.stringify(lang) + ")";

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
    "  if(!v.paused)return JSON.stringify({s:'playing',t:v.currentTime});" + // playing — report currentTime so the caller can confirm it STAYS playing; never touch it
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

  // Phase 1 — click the matchup tile to route to the game's page. Paramount+
  // instead navigates straight to the matched tile's link (see above).
  let routed = false;
  for (let i = 0; i < 8 && !routed; i++) {
    await new Promise((r) => setTimeout(r, 1500)); // hub SPA lazy-loads — keep trying
    if (isParamountUrl(String(await evalValue("location.href")))) {
      let pg: ParamountPage | undefined;
      try {
        pg = JSON.parse((await evalValue(JS_PARAMOUNT_EXTRACT)) as string) as ParamountPage;
      } catch {
        continue; // page navigating / no result this tick
      }
      if (pg.path.includes("/user-profile/whos-watching")) throw new Error("pick a profile, then the match");
      const target = pickParamountTarget(pg.tiles, pg.hero, A, B);
      if (target) {
        try {
          await session.send("Page.navigate", { url: target });
          routed = true;
        } catch {
          /* page navigating — retry */
        }
      }
    } else if ((await evalValue(js)) === true) routed = true;
  }
  if (!routed) return false;

  // Phase 2 — enter the player (Fubo needs a "Watch live" click; Peacock routes
  // straight in) and start it. We declare success only once playback reaches a
  // STEADY STATE — currentTime advancing across several consecutive ~1s samples —
  // NOT on the first non-paused reading. Peacock auto-starts but can re-pause
  // shortly after (an ad/pre-roll gate, or the player's state machine pausing the
  // raw <video>); the old "return on first playing" declared victory too early and
  // left it paused. So whenever it falls back to paused we re-click the Play
  // control and reset the confirmation. We only ever click while paused, so a
  // playing stream is never toggled off (AC#4, no regression).
  const SAMPLE_MS = 1000;
  const STEADY_SAMPLES = 4; // 4 observed currentTime advances (~5 playing reads, ~5s) = steady
  const MAX_SAMPLES = 45; // overall budget: routing-in + ad wait + confirmation
  let lastT: number | null = null;
  let advancing = 0;
  for (let i = 0; i < MAX_SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
    let r: { s?: string; x?: number; y?: number; t?: number } = {};
    try {
      r = JSON.parse((await evalValue(watchJs)) as string);
    } catch {
      continue; // page navigating / no result this tick
    }
    if (r.s === "playing" && typeof r.t === "number") {
      // currentTime moved forward since the last sample → one more steady tick.
      // A stall (ad boundary / buffering / re-pause about to happen) resets it.
      if (lastT !== null && r.t > lastT + 0.05) advancing++;
      else advancing = 0;
      lastT = r.t;
      if (advancing >= STEADY_SAMPLES) return true; // steady — playback confirmed advancing
    } else if (r.s === "play" && typeof r.x === "number" && typeof r.y === "number") {
      await trustedClick(r.x, r.y); // (re)start — covers the initial start AND a re-pause
      lastT = null;
      advancing = 0;
    }
    // 'wait' (paused, no control yet) / 'clicked' / 'none' → keep polling
  }
  return true; // routed to the game even if we couldn't confirm steady playback
}
