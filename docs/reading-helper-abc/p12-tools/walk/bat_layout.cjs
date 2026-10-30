const L = require('./lib2.cjs');

// layout geometry + text measure (no paper text stored)
async function layoutState(page) {
  return page.evaluate(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const shell = document.querySelector('[data-reader-shell]');
    const one = document.querySelector('[data-reader-one-column]');
    const left = document.querySelector('[data-reader-left]');
    const centre = document.querySelector('[data-reader-centre]');
    const inner = document.querySelector('[data-reader-centre-inner]');
    const margin = document.querySelector('[data-reader-margin]');
    const para = Array.from(document.querySelectorAll('#paper-body p')).filter(p => p.textContent.length > 400).slice(0, 4);
    // characters per full line
    const perLine = [];
    for (const p of para) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const lines = []; let cur = null, curTop = null, n = 0;
      while (walker.nextNode()) {
        const t = walker.currentNode; const txt = t.textContent;
        for (let i = 0; i < txt.length; i++) {
          if (/\s/.test(txt[i]) && curTop === null) continue;
          const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
          const rc = rg.getClientRects()[0]; if (!rc || rc.width === 0) { n++; continue; }
          const top = Math.round(rc.top / 4);
          if (curTop === null) { curTop = top; n = 0; }
          if (Math.abs(top - curTop) > 1) { lines.push(n); curTop = top; n = 0; }
          n++;
        }
      }
      lines.pop(); // last (short) line
      perLine.push(...lines.filter(x => x > 10));
    }
    perLine.sort((a, b) => a - b);
    const font = para[0] ? getComputedStyle(para[0]).fontSize : null;
    return {
      vw: window.innerWidth, vh: window.innerHeight, clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth, hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mode: shell ? 'panes' : one ? 'one-column' : 'unknown',
      leftState: shell ? shell.getAttribute('data-left-state') : null,
      left: r(left), centre: r(centre), centreInner: r(inner), margin: r(margin),
      bodyFont: font, charsPerLine: perLine.length ? { n: perLine.length, min: perLine[0], median: perLine[Math.floor(perLine.length / 2)], max: perLine[perLine.length - 1] } : null,
      seps: Array.from(document.querySelectorAll('[role=separator]')).map(s => ({ label: s.getAttribute('aria-label'), orient: s.getAttribute('aria-orientation'), now: s.getAttribute('aria-valuenow'), min: s.getAttribute('aria-valuemin'), max: s.getAttribute('aria-valuemax'), rect: r(s) })),
      rest: Array.from(document.querySelectorAll('.reader-divider-rest')).map(r),
      bottomMargin: !!document.querySelector('[data-reader-bottom-margin]'),
    };
  });
}

// divider visibility/affordance battery for the two pane separators
async function dividerRest(page) {
  await L.injectHelpers(page);
  return page.evaluate(() => {
    const P = window.__p12; const out = [];
    for (const s of document.querySelectorAll('[data-reader-divider]')) {
      const b = s.getBoundingClientRect(); const mid = b.top + Math.min(b.height / 2, 300);
      const cs = getComputedStyle(s); const bf = getComputedStyle(s, '::before');
      const lineCol = P.parse(bf.backgroundColor);
      const leftEl = document.elementFromPoint(b.left - 4, mid), rightEl = document.elementFromPoint(b.right + 4, mid);
      const bgL = P.bgOf(leftEl), bgR = P.bgOf(rightEl);
      const bgS = P.bgOf(s);
      const line = P.over(lineCol, bgS);
      const probes = [0.5, b.width / 2, b.width - 0.5].map(dx => { const el = document.elementFromPoint(b.left + dx, mid); const sep = el && el.closest('[data-reader-divider]'); return { dx: +dx.toFixed(1), hit: !!sep, same: sep === s, cursor: el ? getComputedStyle(el).cursor : null }; });
      out.push({
        pane: s.getAttribute('data-reader-divider'), label: s.getAttribute('aria-label'), rect: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
        cursor: cs.cursor, lineW: bf.width, lineBg: bf.backgroundColor, lineRgb: P.rgb(line), bgLeft: P.rgb(bgL), bgRight: P.rgb(bgR),
        contrastLeft: +P.ratio(line, bgL).toFixed(2), contrastRight: +P.ratio(line, bgR).toFixed(2),
        valueNow: s.getAttribute('aria-valuenow'), valueMin: s.getAttribute('aria-valuemin'), valueMax: s.getAttribute('aria-valuemax'), tabIndex: s.tabIndex,
        cursorProbes: probes, hasGrip: !!s.querySelector('svg,[data-grip]') || bf.content !== 'none',
      });
    }
    return out;
  });
}
async function pseudoOf(page, pane) {
  return page.evaluate((pane) => { const s = document.querySelector('[data-reader-divider="' + pane + '"]'); if (!s) return null; const bf = getComputedStyle(s, '::before'); const P = window.__p12; return { w: bf.width, bg: bf.backgroundColor, rgb: P.rgb(P.parse(bf.backgroundColor)), focusVisible: s.matches(':focus-visible'), hover: s.matches(':hover'), dragging: s.getAttribute('data-dragging'), outline: getComputedStyle(s).outlineStyle }; }, pane);
}
function sepRect(page, pane) { return page.evaluate((pane) => { const s = document.querySelector('[data-reader-divider="' + pane + '"]'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, pane); }
async function gridWidths(page) {
  return page.evaluate(() => { const l = document.querySelector('[data-reader-left]'), c = document.querySelector('[data-reader-centre]'), m = document.querySelector('[data-reader-margin]'); const w = e => e ? +e.getBoundingClientRect().width.toFixed(1) : null; return { left: w(l), centre: w(c), margin: w(m) }; });
}
module.exports = { layoutState, dividerRest, pseudoOf, sepRect, gridWidths };
