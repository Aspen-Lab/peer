// Verification infrastructure only. No timeout, assertion or app source change.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const requested = (process.env.P12_REPEAT_GROUPS ?? '').split(',');
const groups = {
  '07': (f) => ['src/components/reader/responsive-margin', 'src/components/reader/margin-stack-scroll', 'src/components/reader/margin-figure', 'src/components/reader/reader-shell', 'src/components/reader/reader-layout', 'src/components/reader/pane-divider', 'src/components/reader/pane-layout', 'src/components/reader/matted-figure', 'src/components/cards/paper-plate', 'src/components/ui/page-container', 'src/lib/reader/margin.test', 'src/components/reader/explain-box', 'src/components/reader/figure-host', 'src/components/reader/figure-card', 'src/components/reader/figure-zoom', 'src/components/reader/use-figure-zoom', 'src/components/reader/paper-body.figure-open', 'src/components/reader/spread', 'src/components/reader/decision-block', 'src/lib/reader/figure-viewer', 'src/store/reader-panes'].some((prefix) => f.startsWith(prefix)),
  '08': (f) => /src\/store\/notes[.]/.test(f) || /src\/lib\/notes\/(blocks|anchor-blocks|export)[.]/.test(f) || /src\/components\/notes\/(highlight|block-marks|note-tags|sticky-note|note-editor)[.-]/.test(f) || /src\/components\/reader\/(paper-body[.]selection|selection-toolbar)[.-]/.test(f) || f === 'src/components/shell/thumb-bar.test.tsx' || /src\/lib\/reader\/(explain-offer|reader-keys)[.]/.test(f) || /src\/app\/papers\/\[id\]\/page[.](highlight|sticky|explain)[.]test/.test(f),
  '12': (f) => /src\/components\/reader\/(explain-(box|thread)|paper-body)/.test(f) || /src\/lib\/reader\/explain-range/.test(f) || /src\/store\/explain-threads/.test(f) || /src\/app\/papers\/\[id\]\/page.explain/.test(f),
  '16': (f) => ['src/app/globals.css.reading-text.test.ts', 'src/app/globals.css.test.ts', 'src/components/reader/explain-dock.test.ts', 'src/components/reader/left-pane.fit-top.test.ts'].includes(f),
  '19': (f) => /src\/components\/notes\/(note-editor|note-toolbar|wysiwyg-field)[.-]/.test(f),
  '21': (f) => /src\/components\/reader\/margin-(card|stack)[.-]/.test(f) || f === 'src/lib/reader/windows.test.ts',
  place: (f) => /keep-place|keep-selection|reading-position|reader-layout|responsive-margin/.test(f),
};
if (!requested.length || requested.some((id) => !Object.hasOwn(groups, id)) || new Set(requested).size !== requested.length) throw Error('Unknown or duplicate verification group');
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((f) => /\.test\.tsx?$/.test(f));
for (const id of requested) if (!tracked.some(groups[id])) throw Error(`Empty verification group ${id}`);
const files = tracked.filter((f) => requested.some((id) => groups[id](f)));
console.log(`Unchanged touched tests: ${files.length} files; groups ${requested.join(',')}`);
writeFileSync(join(process.env.RUNNER_TEMP, 'p12-repeat-files.json'), JSON.stringify(files));
for (let i = 1; i <= 3; i++) {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', ...files], { encoding: 'utf8' });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(process.env.RUNNER_TEMP, `p12-touched-${i}.log`), log);
  console.log(`Touched repetition ${i}: exit ${result.status}`);
  console.log(log.split(/\r?\n/).filter((l) => /Test Files|Tests /.test(l)).join('\n'));
  if (result.status !== 0) {
    console.log(log.split(/\r?\n/).slice(-100).join('\n'));
    process.exit(result.status ?? 1);
  }
}
