// `stats --html`: one self-contained page — header, a scatter of two key
// stats, a last-10 form heatmap, a ranking bar chart and the full sortable
// table. Pure string building from the LeagueStats the terminal views use; the
// SVG is generated here, so the page needs no CDN and works offline. Every
// team name and label goes through esc(). Colors are CSS custom properties,
// light and dark (prefers-color-scheme); the palette is the dataviz reference
// one (blue / orange / aqua, validated), with W/D/L/OTL also spelled as a
// letter in each cell so color is never the only cue.

import { join } from "node:path";
import { CACHE_DIR } from "./config.ts";
import { formatStat, rankBy, type LeagueStats, type Outcome, type StatDef, type TeamResult, type TeamStatLine } from "./stats.ts";
import { formRows, recordText, recordOf, seasonSuffix } from "./stats-views.ts";

/** Results shown per team in the heatmap. */
export const HEATMAP_LENGTH = 10;

export function statsHtmlPath(sport: string): string {
  return join(CACHE_DIR, `stats-${sport}.html`);
}

/** HTML-escape text for element content and quoted attributes. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const num = (n: number) => String(Math.round(n * 100) / 100);

export interface HtmlOptions {
  favoriteIds: ReadonlySet<string>;
  /** The `--by` stat for the bar chart; null = the profile's first stat. */
  by: StatDef | null;
  /** When the data was loaded. */
  fetchedAt: Date;
}

// ── Scales ───────────────────────────────────────────────────────────────────

/** ~`count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const tickText = (def: StatDef, v: number) => (def.format === "pct" ? `${num(v)}%` : String(num(v)));

// ── Scatter ──────────────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Two stats against each other: one labeled point per team, favorites ringed
 *  and bold, dashed lines at the league average. "Better" is called out per
 *  axis, since lower is better for goals/points against. */
export function renderScatter(stats: LeagueStats, favoriteIds: ReadonlySet<string>): string {
  const xd = stats.profile.stats.find((s) => s.key === stats.profile.scatter.x)!;
  const yd = stats.profile.stats.find((s) => s.key === stats.profile.scatter.y)!;
  const pts = stats.teams
    .map((t) => ({ t, x: t.values[xd.key], y: t.values[yd.key] }))
    .filter((p): p is { t: TeamStatLine; x: number; y: number } => p.x != null && p.y != null);
  const W = 760;
  const H = 520;
  const m = { l: 56, r: 20, t: 16, b: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const range = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    return [lo - pad, hi + pad] as const;
  };
  const [x0, x1] = range(pts.map((p) => p.x));
  const [y0, y1] = range(pts.map((p) => p.y));
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const sy = (v: number) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const parts: string[] = [];
  if (pts.length === 0) return `<p class="muted">No team has data for ${esc(xd.label)} and ${esc(yd.label)}.</p>`;

  for (const v of niceTicks(x0, x1)) {
    parts.push(`<line class="grid" x1="${num(sx(v))}" x2="${num(sx(v))}" y1="${m.t}" y2="${m.t + ph}"/>`);
    parts.push(`<text class="tick" x="${num(sx(v))}" y="${m.t + ph + 16}" text-anchor="middle">${esc(tickText(xd, v))}</text>`);
  }
  for (const v of niceTicks(y0, y1)) {
    parts.push(`<line class="grid" x1="${m.l}" x2="${m.l + pw}" y1="${num(sy(v))}" y2="${num(sy(v))}"/>`);
    parts.push(`<text class="tick" x="${m.l - 8}" y="${num(sy(v) + 4)}" text-anchor="end">${esc(tickText(yd, v))}</text>`);
  }
  const mean = (k: "x" | "y") => pts.reduce((n, p) => n + p[k], 0) / pts.length;
  parts.push(`<line class="avg" x1="${num(sx(mean("x")))}" x2="${num(sx(mean("x")))}" y1="${m.t}" y2="${m.t + ph}"><title>League average ${esc(xd.label)}: ${esc(tickText(xd, mean("x")))}</title></line>`);
  parts.push(`<line class="avg" x1="${m.l}" x2="${m.l + pw}" y1="${num(sy(mean("y")))}" y2="${num(sy(mean("y")))}"><title>League average ${esc(yd.label)}: ${esc(tickText(yd, mean("y")))}</title></line>`);

  const better = (d: StatDef) => (d.higherIsBetter ? "higher is better" : "lower is better");
  parts.push(`<text class="axis" x="${m.l + pw / 2}" y="${H - 10}" text-anchor="middle">${esc(xd.label)} (${better(xd)})</text>`);
  parts.push(`<text class="axis" transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle">${esc(yd.label)} (${better(yd)})</text>`);

  // Points first (so labels sit on top), then labels placed greedily around
  // each point, trying right / left / above / below until one is clear.
  const placed: Box[] = pts.map((p) => ({ x: sx(p.x) - 6, y: sy(p.y) - 6, w: 12, h: 12 }));
  for (const p of pts) {
    const fav = favoriteIds.has(p.t.teamId);
    const tip = `${p.t.name}: ${xd.label} ${formatStat(xd, p.x)}, ${yd.label} ${formatStat(yd, p.y)}`;
    parts.push(`<circle class="pt${fav ? " fav" : ""}" cx="${num(sx(p.x))}" cy="${num(sy(p.y))}" r="${fav ? 7 : 5}"><title>${esc(tip)}</title></circle>`);
  }
  for (const p of [...pts].sort((a, b) => Number(favoriteIds.has(b.t.teamId)) - Number(favoriteIds.has(a.t.teamId)))) {
    const fav = favoriteIds.has(p.t.teamId);
    const label = p.t.abbreviation;
    const w = label.length * 6.8 + 2;
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = fav ? 9 : 7;
    const options: { box: Box; anchor: string; tx: number; ty: number }[] = [
      { box: { x: cx + r, y: cy - 7, w, h: 14 }, anchor: "start", tx: cx + r, ty: cy + 4 },
      { box: { x: cx - r - w, y: cy - 7, w, h: 14 }, anchor: "end", tx: cx - r, ty: cy + 4 },
      { box: { x: cx - w / 2, y: cy - r - 14, w, h: 14 }, anchor: "middle", tx: cx, ty: cy - r - 3 },
      { box: { x: cx - w / 2, y: cy + r, w, h: 14 }, anchor: "middle", tx: cx, ty: cy + r + 11 },
    ];
    const inside = (b: Box) => b.x >= 0 && b.x + b.w <= W && b.y >= 0 && b.y + b.h <= H;
    const pick = options.find((o) => inside(o.box) && !placed.some((q) => overlaps(o.box, q))) ?? options[0]!;
    placed.push(pick.box);
    parts.push(`<text class="plabel${fav ? " fav" : ""}" x="${num(pick.tx)}" y="${num(pick.ty)}" text-anchor="${pick.anchor}">${esc(label)}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${xd.label} against ${yd.label}, one point per team`)}">${parts.join("")}</svg>`;
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

const OUTCOME_CLASS: Record<Outcome, string> = { W: "w", D: "d", L: "l", OTL: "otl" };
const OUTCOME_WORD: Record<Outcome, string> = { W: "Win", D: "Draw", L: "Loss", OTL: "Overtime loss" };

const resultTip = (r: TeamResult) =>
  `${OUTCOME_WORD[r.outcome]} ${r.home ? "vs" : "at"} ${r.opponent}, ${r.scored}–${r.conceded} (${r.date.slice(0, 10)})`;

/** Teams in table order × their last HEATMAP_LENGTH results, oldest → newest
 *  (right-aligned, so the newest game lines up in the last column). */
export function renderHeatmap(stats: LeagueStats, favoriteIds: ReadonlySet<string>): string {
  const byId = new Map(stats.teams.map((t) => [t.teamId, t]));
  const rows = formRows(stats).map((r) => byId.get(r.teamId)!);
  const nameW = 190;
  const cell = 24;
  const gap = 3;
  const top = 26;
  const rowH = cell + gap;
  const W = nameW + HEATMAP_LENGTH * (cell + gap) + 8;
  const H = top + rows.length * rowH + 4;
  const parts: string[] = [];
  for (let c = 0; c < HEATMAP_LENGTH; c++) {
    const label = c === 0 ? "oldest" : c === HEATMAP_LENGTH - 1 ? "latest" : "";
    if (label) parts.push(`<text class="tick" x="${nameW + c * (cell + gap) + (c === 0 ? 0 : cell)}" y="14" text-anchor="${c === 0 ? "start" : "end"}">${label}</text>`);
  }
  rows.forEach((t, i) => {
    const y = top + i * rowH;
    const fav = favoriteIds.has(t.teamId);
    parts.push(`<text class="rowlabel${fav ? " fav" : ""}" x="${nameW - 8}" y="${y + cell / 2 + 4}" text-anchor="end">${fav ? "★ " : ""}${esc(t.name)}</text>`);
    const last = t.results.slice(-HEATMAP_LENGTH);
    last.forEach((r, j) => {
      const col = HEATMAP_LENGTH - last.length + j;
      const x = nameW + col * (cell + gap);
      parts.push(
        `<g class="hm"><rect class="cell ${OUTCOME_CLASS[r.outcome]}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="4"/>` +
          `<text class="cellt ${OUTCOME_CLASS[r.outcome]}" x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle">${r.outcome === "OTL" ? "OT" : r.outcome}</text>` +
          `<title>${esc(`${t.name}: ${resultTip(r)}`)}</title></g>`,
      );
    });
  });
  const legendKeys: Outcome[] = stats.profile.form === "wdl" ? ["W", "D", "L"] : stats.profile.form === "wl" ? ["W", "L"] : ["W", "L", "OTL"];
  const legend = legendKeys
    .map((o) => `<span class="key"><span class="sw ${OUTCOME_CLASS[o]}">${o === "OTL" ? "OT" : o}</span>${OUTCOME_WORD[o]}</span>`)
    .join("");
  return (
    `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Last ${HEATMAP_LENGTH} results per team">${parts.join("")}</svg>` +
    `<p class="legend">${legend}<span class="muted">Teams in table order. Hover a cell for the opponent and score.</span></p>`
  );
}

// ── Bars ─────────────────────────────────────────────────────────────────────

/** One stat ranked, best first: horizontal bars from zero, values labeled. */
export function renderBars(stats: LeagueStats, def: StatDef, favoriteIds: ReadonlySet<string>): string {
  const rows = rankBy(stats, def.key);
  if (rows.length === 0) return `<p class="muted">No team has data for ${esc(def.label)}.</p>`;
  const labelW = 190;
  const valueW = 64;
  const barMax = 440;
  const rowH = 24;
  const barH = 14;
  const W = labelW + barMax + valueW;
  const H = rows.length * rowH + 4;
  const top = Math.max(...rows.map((r) => r.value), 0);
  const parts: string[] = [];
  rows.forEach(({ rank, team, value }, i) => {
    const y = i * rowH + 2;
    const fav = favoriteIds.has(team.teamId);
    const w = top > 0 ? Math.max(2, (Math.max(value, 0) / top) * barMax) : 2;
    const tip = `${team.name}: ${def.label} ${formatStat(def, value)} (rank ${rank}, ${team.played} played)`;
    parts.push(
      `<g class="bar"><text class="rowlabel${fav ? " fav" : ""}" x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(`${rank}  `)}${fav ? "★ " : ""}${esc(team.name)}</text>` +
        `<rect class="barfill${fav ? " fav" : ""}" x="${labelW}" y="${y}" width="${num(w)}" height="${barH}" rx="3"/>` +
        `<text class="val${fav ? " fav" : ""}" x="${num(labelW + w + 6)}" y="${y + barH / 2 + 4}">${esc(formatStat(def, value))}</text>` +
        `<title>${esc(tip)}</title></g>`,
    );
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${def.label} by team, best first`)}">${parts.join("")}</svg>`;
}

// ── Table ────────────────────────────────────────────────────────────────────

/** Every profile stat per team with its league rank; favorites starred. Rows
 *  start in table order; a column header click sorts (see SCRIPT). */
export function renderTable(stats: LeagueStats, favoriteIds: ReadonlySet<string>): string {
  const byId = new Map(stats.teams.map((t) => [t.teamId, t]));
  const rows = formRows(stats);
  const sd = stats.profile.stats;
  const th = (label: string, type: "text" | "num", best: "asc" | "desc", title = "") =>
    `<th scope="col" aria-sort="none"${title ? ` title="${esc(title)}"` : ""}><button type="button" data-type="${type}" data-best="${best}">${esc(label)}</button></th>`;
  const head =
    th("#", "num", "asc", "Table position") +
    th("Team", "text", "asc") +
    th("P", "num", "desc", "Games played") +
    th("Record", "num", "desc", "Sorts by wins") +
    sd.map((d) => th(d.short, "num", d.higherIsBetter ? "desc" : "asc", `${d.label} — ${d.higherIsBetter ? "higher" : "lower"} is better`)).join("");
  const body = rows
    .map((r, i) => {
      const t = byId.get(r.teamId)!;
      const fav = favoriteIds.has(t.teamId);
      const cells = sd
        .map((d) => {
          const v = t.values[d.key];
          const rk = t.ranks[d.key];
          return `<td data-v="${v ?? ""}">${esc(formatStat(d, v ?? null))}${rk != null ? ` <small class="rk">#${rk}</small>` : ""}</td>`;
        })
        .join("");
      const rec = recordText(recordOf(t.results), stats.profile.form);
      return (
        `<tr${fav ? ' class="fav"' : ""}><td data-v="${i + 1}">${i + 1}</td><td data-v="${esc(t.name.toLowerCase())}">${fav ? '<span class="star" title="Favorite">★</span> ' : ""}${esc(t.name)}</td>` +
        `<td data-v="${t.played}">${t.played}</td><td data-v="${recordOf(t.results).w}">${esc(rec)}</td>${cells}</tr>`
      );
    })
    .join("");
  return `<div class="scroll"><table id="stats-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const SCRIPT = `(function(){var t=document.getElementById('stats-table');if(!t)return;
Array.prototype.forEach.call(t.tHead.rows[0].cells,function(th,i){var b=th.firstChild;
b.addEventListener('click',function(){var cur=th.getAttribute('aria-sort');
var dir=cur==='none'?b.dataset.best:(cur==='ascending'?'desc':'asc');
Array.prototype.forEach.call(t.tHead.rows[0].cells,function(o){o.setAttribute('aria-sort','none');});
th.setAttribute('aria-sort',dir==='asc'?'ascending':'descending');
var num=b.dataset.type==='num';var rows=Array.prototype.slice.call(t.tBodies[0].rows);
function key(r){var v=r.cells[i].dataset.v;return num?(v===''?null:parseFloat(v)):v;}
rows.sort(function(a,c){var x=key(a),y=key(c);if(x===null&&y===null)return 0;if(x===null)return 1;if(y===null)return -1;
var r=x<y?-1:x>y?1:0;return dir==='asc'?r:-r;});
rows.forEach(function(r){t.tBodies[0].appendChild(r);});});});})();`;

const STYLE = `
:root{color-scheme:light dark;--bg:#fcfcfb;--panel:#fff;--ink:#0b0b0b;--ink2:#52514e;--muted:#6b6a65;--line:#e4e3de;--grid:#ecebe6;
--series:#2a78d6;--fav-ink:#0b0b0b;
--w:#2a78d6;--w-ink:#fff;--d:#9a9992;--d-ink:#0b0b0b;--l:#eb6834;--l-ink:#0b0b0b;--otl:#f6c3ac;--otl-ink:#0b0b0b}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--panel:#222221;--ink:#f0efec;--ink2:#c3c2b7;--muted:#a3a299;--line:#3a3a37;--grid:#2e2e2c;
--series:#3987e5;--fav-ink:#f0efec;
--w:#3987e5;--w-ink:#0b0b0b;--d:#6b6a65;--d-ink:#fff;--l:#d95926;--l-ink:#0b0b0b;--otl:#6b3a29;--otl-ink:#f0efec}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 56px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:0 0 4px}
.sub{color:var(--ink2);margin:0}.note{margin:10px 0 0;padding:8px 12px;border-left:3px solid var(--l);background:var(--panel);color:var(--ink)}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-top:20px}
section>p.sub{margin-bottom:10px}
.chart{width:100%;height:auto;display:block}
.muted{color:var(--muted)}
.grid{stroke:var(--grid);stroke-width:1}.avg{stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4}
.tick{fill:var(--muted);font-size:11px}.axis{fill:var(--ink2);font-size:12px}
.pt{fill:var(--series);fill-opacity:.85;stroke:var(--panel);stroke-width:2}.pt.fav{stroke:var(--fav-ink);stroke-width:3;fill-opacity:1}
.plabel{fill:var(--ink2);font-size:11px}.plabel.fav,.rowlabel.fav,.val.fav{fill:var(--ink);font-weight:700}
.rowlabel{fill:var(--ink);font-size:12px}.val{fill:var(--ink2);font-size:12px}
.barfill{fill:var(--series)}.barfill.fav{stroke:var(--fav-ink);stroke-width:2}
.cell.w,.sw.w{fill:var(--w);background:var(--w)}.cell.d,.sw.d{fill:var(--d);background:var(--d)}.cell.l,.sw.l{fill:var(--l);background:var(--l)}
.cell.otl{fill:var(--otl);stroke:var(--l);stroke-width:1.5}.sw.otl{background:var(--otl);box-shadow:inset 0 0 0 1.5px var(--l)}
.cellt{font-size:11px;font-weight:700;pointer-events:none}.cellt.w{fill:var(--w-ink)}.cellt.d{fill:var(--d-ink)}.cellt.l{fill:var(--l-ink)}.cellt.otl{fill:var(--otl-ink)}
.sw.w{color:var(--w-ink)}.sw.d{color:var(--d-ink)}.sw.l{color:var(--l-ink)}.sw.otl{color:var(--otl-ink)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin:10px 0 0;color:var(--ink2)}
.key{display:inline-flex;align-items:center;gap:6px}.sw{display:inline-block;min-width:24px;height:20px;border-radius:4px;text-align:center;font-size:11px;font-weight:700;line-height:20px}
.hm:hover .cell{stroke:var(--ink);stroke-width:2}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:5px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
th:nth-child(2),td:nth-child(2),th:nth-child(4),td:nth-child(4){text-align:left}
th button{all:unset;cursor:pointer;font-weight:600;color:var(--ink2)}th button:hover,th button:focus-visible{color:var(--ink);text-decoration:underline}
th[aria-sort=ascending] button::after{content:" \\25B2";font-size:9px}th[aria-sort=descending] button::after{content:" \\25BC";font-size:9px}
tr.fav td{font-weight:700}.star{color:var(--l)}.rk{color:var(--muted);font-weight:400}
footer{margin-top:20px;color:var(--muted);font-size:12px}
`;

/** The whole page. */
export function renderStatsHtml(stats: LeagueStats, opts: HtmlOptions): string {
  const by = opts.by ?? stats.profile.stats[0]!;
  const fav = opts.favoriteIds;
  const sd = stats.profile.stats;
  const sx = sd.find((s) => s.key === stats.profile.scatter.x)!;
  const sy = sd.find((s) => s.key === stats.profile.scatter.y)!;
  const note =
    stats.kind === "last-season"
      ? `<p class="note">${esc(stats.upcoming ? `The ${stats.upcoming} regular season` : "The regular season")} hasn't started — showing last season's stats.</p>`
      : "";
  const title = `${stats.label} stats ${seasonSuffix(stats)}`.trim();
  const dir = (d: StatDef) => (d.higherIsBetter ? "higher is better" : "lower is better");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style></head>
<body><main>
<header><h1>${esc(stats.label)} stats</h1>
<p class="sub">Season ${esc(seasonSuffix(stats))} · data fetched ${esc(opts.fetchedAt.toLocaleString())}</p>${note}</header>
<section id="scatter"><h2>${esc(sx.label)} vs ${esc(sy.label)}</h2>
<p class="sub">One point per team; favorites ringed. Dashed lines mark the league average. Hover a point for the figures.</p>
${renderScatter(stats, fav)}</section>
<section id="form"><h2>Form, last ${HEATMAP_LENGTH} results</h2>
${renderHeatmap(stats, fav)}</section>
<section id="ranking"><h2>${esc(by.label)} by team</h2>
<p class="sub">Best first (${dir(by)}). Rank at the left of each name.</p>
${renderBars(stats, by, fav)}</section>
<section id="table"><h2>All stats</h2>
<p class="sub">Click a column header to sort. Small figures are league ranks.</p>
${renderTable(stats, fav)}</section>
<footer>Generated by sportsing from ESPN data. ★ favorite.</footer>
</main>
<script>${SCRIPT}</script></body></html>
`;
}
