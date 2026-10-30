// P12-92: the observations O5 (the notes window at W3), O6 (text pipeline counts), O7 (the note's [n] tag inside a word), O8 (the map's last row). Counts and geometry only; no paper words are stored.
// Usage: node o568.cjs P1
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
const PACK = L.R + '/pack';
const key = process.argv[2];

(async () => {
  const out = { cell: `O568-${key}-default-light`, input: key, load: require('os').loadavg()[0] };
  // ---- O6 and O8 at W1 (no card)
  {
    const s = await L.openPaper(key, L.W.W1, {}); const p = s.page;
    out.O6 = await p.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('#paper-body p, #paper-body h1, #paper-body h2, #paper-body h3, #paper-body h4, #paper-body li')).filter(e => !e.closest('figure'));
      const items = blocks.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), h: /^H\d$/.test(e.tagName) }));
      const noEnd = (t) => !/[.?!:;)\]”"']\s*$/.test(t);
      const short = items.filter(x => x.t.length < 60 && noEnd(x.t));
      const shortNoHead = short.filter(x => !x.h);
      const words = (t) => t.split(/\s+/).filter(Boolean).length;
      return { blocks: items.length, headings: items.filter(x => x.h).length, shortNoSentenceEnd: short.length, shortNoSentenceEndExcludingHeadings: shortNoHead.length, shortAtMostThreeWords: shortNoHead.filter(x => words(x.t) <= 3).length, runningFootStarts: items.filter(x => /\(\d+ of \d+\)/.test(x.t.slice(0, 90))).length, runningFootAnywhere: items.filter(x => /\(\d+ of \d+\)/.test(x.t)).length, orcidMentions: items.filter(x => /orcid/i.test(x.t)).length, licenceMentions: items.filter(x => /creative commons|licen[cs]e/i.test(x.t)).length, firstBlockIsHeading: items.length ? items[0].h : null, firstBlockLength: items.length ? items[0].t.length : null };
    });
    out.O8 = await p.evaluate(() => {
      const sec = Array.from(document.querySelectorAll('section[aria-label]')).find(s => /map|paper at a glance|section/i.test(s.getAttribute('aria-label')) && s.querySelector('li a[href^="#"]'));
      if (!sec) return { err: 'no map section' };
      const rows = Array.from(sec.querySelectorAll('li[data-level]')).map(li => { const a = li.querySelector('a[href^="#"]'); return { level: +li.getAttribute('data-level'), id: a ? a.getAttribute('href').slice(1) : null, labelLen: (a ? a.textContent : '').length }; }).filter(r => r.id);
      const body = document.querySelector('#paper-body');
      const targets = rows.map(r => { const e = document.getElementById(r.id); return e && body.contains(e) ? e : null; });
      const wordsBetween = (a, b) => { const rg = document.createRange(); rg.setStartBefore(a); if (b) rg.setEndBefore(b); else rg.setEndAfter(body.lastChild || body); const t = rg.toString(); return t.split(/\s+/).filter(Boolean).length; };
      const top = rows.map((r, i) => ({ ...r, el: targets[i] })).filter(r => r.el && r.level <= 1);
      const res = top.map((r, i) => ({ level: r.level, words: wordsBetween(r.el, top[i + 1] ? top[i + 1].el : null) }));
      const lastAll = rows.map((r, i) => ({ ...r, el: targets[i] })).filter(r => r.el);
      const resAll = lastAll.map((r, i) => wordsBetween(r.el, lastAll[i + 1] ? lastAll[i + 1].el : null));
      return { rowsWithLinks: rows.length, rowsResolved: lastAll.length, topLevelRows: top.length, topLevelWords: res.map(r => r.words), lastTopLevelRowWords: res.length ? res[res.length - 1].words : null, maxTopLevelRowWords: res.length ? Math.max(...res.map(r => r.words)) : null, lastRowWords: resAll.length ? resAll[resAll.length - 1] : null, maxRowWords: resAll.length ? Math.max(...resAll) : null, bodyWords: body.innerText.split(/\s+/).filter(Boolean).length };
    });
    await s.browser.close();
  }
  // ---- O7 and O5 at W3 and W1
  for (const wn of ['W1', 'W3']) {
    const s = await L.openPaper(key, L.W[wn], {}); const p = s.page; const paras = await C.goodParas(p);
    // O7: take notes on a drag that ends inside a word; look at the characters either side of the [n] tag
    const sel = await C.openSticky(p, paras[5], { y: Math.min(300, Math.round(L.W[wn][1] * 0.4)), x0: 31, x1: 247 });
    await p.waitForTimeout(600);
    out['O7_' + wn] = await p.evaluate(() => {
      const body = document.querySelector('#paper-body'); const found = [];
      for (const b of body.querySelectorAll('button, sup, a')) { const t = b.textContent.trim(); if (!/^\[\d+\]$/.test(t)) continue; const pv = b.previousSibling, nx = b.nextSibling; const before = pv ? pv.textContent.slice(-1) : ''; const after = nx ? nx.textContent.slice(0, 1) : ''; found.push({ tagText: t, el: b.tagName, before: /[A-Za-z]/.test(before) ? 'letter' : (before ? 'other' : 'none'), after: /[A-Za-z]/.test(after) ? 'letter' : (after ? 'other' : 'none') }); }
      const el = [];
      return { found, elements: el };
    });
    await p.screenshot({ path: `${PACK}/O7-${key}-${wn}-default-light.png` });
    // O5: the notes window
    if (wn === 'W3') {
      await p.evaluate(() => window.scrollTo(0, window.scrollY));
      const tab = p.locator('button').filter({ hasText: /open your notes/i }).first();
      // a saved note with a line of the harness's own invented words, so that the window holds one note row of the reader's
      const ed = p.locator('[data-margin-card=sticky] [contenteditable=true]').first();
      await ed.click({ timeout: 8000 }).catch(() => {}); await p.keyboard.type('invented line 1 of note text'); await p.waitForTimeout(400);
      await p.locator('[data-margin-card=sticky] button[aria-label^="Save note"]').first().click({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(900);
      await C.closeAll(p);
      const opener = p.getByRole('button', { name: /open your notes|take notes on this paper/i }).first();
      await opener.click({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1200);
      const o5 = () => p.evaluate(() => {
        const win = document.querySelector('section[aria-label="Your notes"]'); if (!win) return { err: 'no notes window' };
        const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
        const wr = r(win);
        const scroller = Array.from(win.querySelectorAll('*')).find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) || null;
        const sr = scroller ? r(scroller) : null;
        const vis = (b) => { if (!sr) return b.bottom <= wr.bottom ? 'full' : 'cut'; if (b.bottom <= sr.bottom + 0.5 && b.y >= sr.y - 0.5) return 'full'; if (b.y >= sr.bottom) return 'below'; if (b.bottom <= sr.y) return 'above'; return 'partial'; };
        const rows = Array.from(win.querySelectorAll('[data-row]')).map(e => { const b = r(e); return { ...b, vis: vis(b) }; });
        const toolbar = win.querySelector('[role=toolbar]'); const title = win.querySelector('h1,h2,h3,[data-notes-title]');
        return { vw: innerWidth, vh: innerHeight, win: wr, winHeightShareOfViewport: +(wr.h / innerHeight).toFixed(3), toolbar: r(toolbar), title: r(title), scrollerRect: sr, rows: rows.length, rowList: rows, scroller: scroller ? { clientH: scroller.clientHeight, scrollH: scroller.scrollHeight } : null };
      });
      out.O5_W3 = await o5();
      await p.screenshot({ path: `${PACK}/O5-${key}-W3-default-light.png` });
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
      // the same with a sticky card open beside the window (the window and the card share the margin)
      await C.openSticky(p, paras[7], { y: Math.min(300, Math.round(L.W[wn][1] * 0.4)) }); await p.waitForTimeout(600);
      await p.getByRole('button', { name: /open your notes|take notes on this paper/i }).first().click({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1200);
      out.O5_W3_withCard = await o5(); out.O5_W3_withCard.cards = (await C.cardsInfo(p)).cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h }));
      await p.screenshot({ path: `${PACK}/O5-${key}-W3-withcard-default-light.png` });
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    }
    await C.closeAll(p).catch(() => {});
    out['pageerrors_' + wn] = s.log.pageerrors;
    await s.browser.close();
  }
  L.fs.writeFileSync(`${PACK}/${out.cell}.json`, JSON.stringify(out, null, 1));
  console.log(out.cell, JSON.stringify({ O6: out.O6, O8: out.O8 && { rows: out.O8.rowsResolved, last: out.O8.lastRowWords, lastTop: out.O8.lastTopLevelRowWords, max: out.O8.maxRowWords }, O7: [out.O7_W1 && out.O7_W1.found, out.O7_W3 && out.O7_W3.found], O5: out.O5_W3 && { win: out.O5_W3.win, rows: out.O5_W3.rows, vis: out.O5_W3.rowList && out.O5_W3.rowList.map(r => r.vis), withCard: out.O5_W3_withCard && { win: out.O5_W3_withCard.win, vis: out.O5_W3_withCard.rowList && out.O5_W3_withCard.rowList.map(r => r.vis) } } }));
})().catch(e => { console.error('ERR', e); process.exit(1); });
