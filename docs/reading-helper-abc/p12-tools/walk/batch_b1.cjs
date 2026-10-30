const { run } = require('./cell_b1.cjs');
(async () => {
  const cells = [['R1','W1',2,false],['R2','W1',2,false],['R1','W2',2,false],['R2','W2',2,false],['R1','W3',2,false],['R2','W3',2,false],
    ['R1','W1',0,false],['R1','W1',7,false],['R1','W1',7,true],['R1','W4',2,false]];
  for (const c of cells) {
    try { const r = await run(...c); console.log('OK', r.cell, r.layout.mode, r.layout.leftState, JSON.stringify(r.panes.left && r.panes.left.drag && [r.panes.left.drag.before, r.panes.left.drag.after]), JSON.stringify(r.panes.margin && r.panes.margin.drag && [r.panes.margin.drag.before, r.panes.margin.drag.after])); }
    catch (e) { console.log('FAIL', c.join(','), e.message.slice(0, 300)); }
  }
})();
