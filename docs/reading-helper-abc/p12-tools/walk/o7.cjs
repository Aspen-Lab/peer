// O7: where does the note's [n] tag stand when the selection ends inside a word? A drag from a paragraph's first word to the middle of a long word on its first line, then Take notes.
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const out = { cell: 'O7b-all-W1-default-light', papers: {} };
  for (const key of ['P1', 'P2', 'P3']) {
    const s = await L.openPaper(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
    const rec = {};
    for (const pi of [5, 6, 7]) {
      await C.scrollParaTo(p, paras[pi], 260);
      const tgt = await p.evaluate((idx) => {
        const e = document.querySelectorAll('#paper-body p')[idx]; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const first = e.getBoundingClientRect();
        let startPt = null; const ws = [];
        while (w.nextNode()) { const n = w.currentNode; const t = n.textContent; const re = /[A-Za-z]{8,}/g; let m; while ((m = re.exec(t))) { const rg = document.createRange(); rg.setStart(n, m.index + 4); rg.setEnd(n, m.index + 5); const r = rg.getClientRects()[0]; if (!r) continue; ws.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, wordLen: m[0].length }); } }
        const firstLineTop = ws.length ? Math.min(...ws.map(x => x.top)) : null; const cand = ws.filter(x => Math.abs(x.top - firstLineTop) < 3 && x.x > first.left + 120)[0] || ws[0];
        return { px: first.left + 30, cand, h: first.height };
      }, paras[pi]);
      if (!tgt.cand) { rec['p' + pi] = { err: 'no long word' }; continue; }
      await p.mouse.move(tgt.px, tgt.cand.y); await p.mouse.down(); await p.mouse.move((tgt.px + tgt.cand.x) / 2, tgt.cand.y, { steps: 6 }); await p.mouse.move(tgt.cand.x, tgt.cand.y, { steps: 6 }); await p.mouse.up();
      for (let i = 0; i < 12; i++) { await p.waitForTimeout(300); if (await C.toolbar(p)) break; }
      const selEnd = await p.evaluate(() => { const s = getSelection(); if (!s || s.isCollapsed) return null; const r = s.getRangeAt(0); const n = r.endContainer; const t = n.textContent || ''; const o = r.endOffset; return { endInsideWord: /[A-Za-z]/.test(t[o - 1] || '') && /[A-Za-z]/.test(t[o] || ''), len: s.toString().length }; });
      if (!selEnd) { rec['p' + pi] = { err: 'no selection' }; continue; }
      await p.getByRole('button', { name: 'Take notes' }).click({ timeout: 20000, noWaitAfter: true }).catch(() => {}); await p.waitForTimeout(1200);
      const tag = await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; const bs = Array.from(e.querySelectorAll('button')).filter(b => /^\[\d+\]$/.test(b.textContent.trim())); return bs.map(b => { const pv = b.previousSibling, nx = b.nextSibling; const before = pv ? pv.textContent.slice(-1) : ''; const after = nx ? nx.textContent.slice(0, 1) : ''; return { before: /[A-Za-z]/.test(before) ? 'letter' : (before ? 'other' : 'none'), after: /[A-Za-z]/.test(after) ? 'letter' : (after ? 'other' : 'none') }; }); }, paras[pi]);
      rec['p' + pi] = { selEnd, tag };
      await p.screenshot({ path: `${L.R}/pack/O7b-${key}-p${pi}-W1-default-light.png`, clip: { x: 340, y: 60, width: 720, height: 400 } });
      await C.closeAll(p);
    }
    out.papers[key] = rec; out[key + '_pe'] = s.log.pageerrors.length; await s.browser.close();
  }
  L.fs.writeFileSync(`${L.R}/pack/${out.cell}.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.papers));
})().catch(e => { console.error('ERR', e); process.exit(1); });
