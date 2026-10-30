// a selection that runs across a figure block: does the page say why it offers nothing? (body, P1 W1: 3 paragraphs with a figure between them)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const key = process.argv[2] || 'P1'; const s = await L.openPaper(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
  const out = { cell: `LONGSEL2-${key}-W1-${(process.argv[3]||'2,3').replace(/,/g,'')}`, runs: [] };
  for (const span of (process.argv[3] || '2,3').split(',').map(Number)) {
    const a = paras[4], b = paras[4 + span];
    await C.scrollParaTo(p, a, 220);
    const st = await p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 14 }; }, a);
    await p.mouse.click(st.x, st.y); await C.scrollParaTo(p, b, 300);
    const en = await p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; const r = e.getBoundingClientRect(); return { x: r.x + 200, y: r.y + 14 }; }, b);
    await p.keyboard.down('Shift'); await p.mouse.click(en.x, en.y); await p.keyboard.up('Shift'); await p.waitForTimeout(2500);
    const rec = await p.evaluate(() => {
      const s = getSelection(); const rg = s && !s.isCollapsed ? s.getRangeAt(0) : null;
      let figs = 0, controls = 0; if (rg) { for (const f of document.querySelectorAll('#paper-body figure')) if (rg.intersectsNode(f)) figs++; for (const b of document.querySelectorAll('#paper-body button')) if (rg.intersectsNode(b)) controls++; }
      const hints = Array.from(document.querySelectorAll('[role=status],[role=alert],[aria-live]')).map(e => e.textContent.trim()).filter(Boolean).slice(0, 4);
      const txt = document.body.innerText; const m = /Select paper text without controls[^.]*\./.exec(txt);
      return { len: rg ? s.toString().length : 0, figuresInRange: figs, controlsInRange: controls, toolbar: !!document.querySelector('[role=toolbar][aria-label="Selection actions"]'), hints, reasonShownInPage: m ? m[0] : null };
    });
    out.runs.push({ span, ...rec }); await p.screenshot({ path: `${L.R}/pack/LONGSEL2-${key}-span${span}.png` });
    await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
  }
  out.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${L.R}/pack/${out.cell}.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.runs)); await s.browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
