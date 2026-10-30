import json,glob,os,re,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
def J(f):
    try: return json.load(open(R+f))
    except Exception as e: return None
def files(prefix): return sorted(os.path.basename(x) for x in glob.glob(R+prefix+'*'))
out=[]
def w(s=''): out.append(s)
STEPN={0:'smallest',2:'default',7:'largest'}
PAPERS=['P1','P2','P3']
def acc(rgb,bg):
    def p(s): return [int(x) for x in s[s.index('(')+1:s.index(')')].split(',')]
    def lum(c):
        f=lambda v:(v/255/12.92) if v/255<=0.03928 else ((v/255+0.055)/1.055)**2.4
        return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
    a,b=lum(p(rgb)),lum(p(bg)); hi,lo=max(a,b),min(a,b); return round((hi+0.05)/(lo+0.05),2)
# ---------------------------------------------------------------- header
w('# Evidence pack index — P12-38 (Theme B, round 2)')
w()
w('Head walked `019793b9ae62c6c40942b86de33d2e8743e3bd26` (branch `update-on-paper-digest`, detached worktree). Chromium only (Playwright, headless, device scale 1, CSS-viewport emulation; no real browser zoom). Server: the dev server with the model stub (`next dev -p 4247`). Papers: the owner\'s P1 (10 pp.), P2 (10 pp.), P3 (11 pp.), each entered only through the app\'s file chooser and consent. This index lists observations and file names only; it carries no score and no verdict.')
w()
w('Widths (CSS viewport): W1 1440×900, W2 1024×576, W3 853×480, W4 390×844. Reading steps the app offers (Larger / Smaller text): 0.85 (smallest), 0.925, 1 (default), 1.1, 1.2, 1.32, 1.45, 1.6 (largest). Dark = the app\'s own night control. Profiles: **no key** (fresh browser profile, Tier 0) and **placeholder key** (second fresh profile, an invented OpenAI-shaped key typed into the app\'s AI-setup step, Deep report switched on in Profile so the stub can answer; the stub answers `api.openai.com` from the paper\'s own sentences and its canned phrases are a harness artefact). The body-text hash used throughout is the SHA-256 (first 16 hex) of the paragraph, heading and list-item text of `#paper-body` outside figure blocks (figure blocks carry an app-written page hint).')
w()
w('File naming: `<unit>-<paper>-<width>-<step>-<theme>.<json|png>`; extra suffixes name the state (`-hover-left`, `-open`, ...). Every cell JSON also holds the machine load average at its start, the page errors and the console errors / warnings (the known environment noise — the egress-blocked font/feed requests and the dev server\'s `/api/read` 500 — is filtered out and counted as zero).')
w()
# ---------------------------------------------------------------- B1
w('## B1 — the pane dividers'); w()
for P in PAPERS:
    w(f'### {P}')
    for f in sorted(glob.glob(R+f'B1-{P}-*.json')):
        d=J(os.path.basename(f)); L=d['layout']; cell=d['cell']
        w(f'- **{cell}** — files: `{cell}.json`, `{cell}.png`'+''.join(f', `{cell}-{k}-{pn}.png`' for pn in ('left','margin') if d['panes'].get(pn,{}).get('present') for k in ('hover','focus')))
        w(f'  - layout: mode {L["mode"]}, left state {L["leftState"]}; left/centre/margin widths {L["left"] and L["left"]["w"]}/{L["centre"] and L["centre"]["w"]}/{L["margin"] and L["margin"]["w"]} px; viewport scroll width {L["scrollWidth"]} / client {L["clientWidth"]}; text measure {json.dumps(L["charsPerLine"])} characters per line (n lines, min, median, max); body font {L["bodyFont"]}; separators {len(L["seps"])}; rail hairlines {len(L["rest"])}')
        for r in d['rest']:
            pn=d['panes'][r['pane']]; k=pn['keys']; dr=pn['drag']; hv=pn['hover']; fo=pn['focus']
            w(f'  - divider `{r["pane"]}`: strip {r["rect"]["w"]} px wide, rest line {r["lineW"]} {r["lineRgb"]}, contrast against left/right neighbour {r["contrastLeft"]} / {r["contrastRight"]}; cursor {r["cursor"]}, probes at left edge / centre / right edge hit the strip: {[ (c["same"],c["cursor"]) for c in r["cursorProbes"]]}; hover line {hv["w"]} {hv["rgb"]} (contrast vs left neighbour {acc(hv["rgb"],r["bgLeft"])}); keyboard-focus line {fo["w"]} {fo["rgb"]}, focus-visible {fo["focusVisible"]}; aria value now/min/max {r["valueNow"]}/{r["valueMin"]}/{r["valueMax"]}; keys: start {k["start"]}, ArrowGrow {k["grow1"]["v"]}, Shift+ArrowGrow {k["growShift"]["v"]}, ArrowShrink {k["shrink1"]["v"]}, End {k["end"]["v"]} (centre {k["end"]["grid"]["centre"]}), Home {k["home"]["v"]} (centre {k["home"]["grid"]["centre"]}), Enter {k["enter"]["v"]}; real drag {dr["dx"]:+d} px: {dr["before"]} → {dr["after"]}, grid {dr["gridBefore"]} → {dr["gridAfter"]}')
        for pn,v in d['panes'].items():
            if not v.get('present'): w(f'  - divider `{pn}`: no separator element in this cell')
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}; load {round(d["load"],1)}')
    w()

# ---------------------------------------------------------------- B2
w('## B2 — the breakpoint rule and the narrow page'); w()
w('Rule found in the code: `web/src/components/reader/reader-layout.tsx` `useSpread()` (lines 122–126) compares `documentElement.clientWidth` with `railMinimumWidth(scale)` in `web/src/components/reader/pane-layout.ts` (lines 195–203) = 48 (rail) + 280 (margin minimum) + 24 (two dividers) + ceil(476 × scale + 24); below it the page is one column with a bottom-docked margin (`responsive-margin.tsx`); ruling §1h.197.'); w()
for P in PAPERS:
    d=J(f'B2-{P}-default-light.json')
    w(f'### {P}')
    if not d: w('- (no B2 file in the pack)'); w(); continue
    w(f'- **B2-{P}-default-light** — files: `B2-{P}-default-light.json`, `B2-{P}-W3-default-light-selection.png`, `B2-{P}-W4-default-light-selection.png`, `B2-{P}-W3-default-light-notes.png`, `B2-{P}-W4-default-light-notes.png`, `B2-{P}-W1-start-cards.png`, `B2-{P}-W3-cards.png`, `B2-{P}-W4-cards.png`')
    for k,v in d['sweep'].items(): w(f'  - boundary sweep at step {k} (scale {v["step"]}): predicted minimum {v["predictedMinimum"]} px, measured smallest width with panes {v["measuredMinimum"]} px; one below: {v["justBelow"]}; at it: {v["atMinimum"]}')
    for wn,r in d['narrow'].items():
        L=r['layout']; tb=r.get('toolbar')
        w(f'  - {wn}: mode {L["mode"]} ({L["leftState"]}); centre {L["centre"] and L["centre"]["w"]} px; characters per line {json.dumps(L["charsPerLine"])}; horizontal overflow {L["hOverflow"]}; selection {json.dumps(r.get("selection"))}; selection actions {tb and [b["name"] for b in tb["buttons"]]} (phone bar: {tb and tb.get("phone")}); Highlight marks after press {r.get("highlightMarks")}; Take notes cards {r.get("sticky")}; Notes button count {r.get("notesButton")}, notes window opened {r.get("notesWindow")}')
    kp=d.get('keepPlace',{})
    for k,v in kp.items(): w(f'  - keep-place snapshot `{k}`: viewport {v["vp"]}, cards {v["kinds"]} heights {v["h"]}, first visible paragraph {json.dumps(v["ref"])}, drafts {json.dumps(v["drafts"])}')
    w(f'  - body hash before/after: n/a (see pass-requirement table); page errors {len(d.get("pageerrors",[]))}; console {len(d.get("console",[]))}')
    w()
# ---------------------------------------------------------------- B3 / B4 / B5
def cardcells(P):
    return sorted(os.path.basename(x) for x in glob.glob(R+f'B345-{P}-*.json'))
w('## B3 / B4 / B5 — the cards, their boundaries, a third card'); w()
for P in PAPERS:
    w(f'### {P}')
    for fn in cardcells(P):
        d=J(fn); cell=d['cell']
        w(f'- **{cell}** — files: `{fn}`, screenshots `B3-single-explain-{cell}.png`, `B3-single-sticky-{cell}.png`, `B3-single-figure-{cell}.png`, `B3-two-{cell}.png`, `B4-hover-{cell}.png`, `B4-focus-{cell}.png`, `B4-drag-{cell}.png`, `B4-min-lower-{cell}.png`, `B4-min-upper-{cell}.png`, `B5-*-{cell}.png`; load {round(d["load"],1)}')
        P1_=d['P1']; P2_=d['P2']; P2b=d.get('P2b',{})
        w(f'  - single Explain card: top minus the selection\'s first-line top {P1_["explain"]["alignDelta"]} px; card rect (top,h,left,w) {[ (c["top"],c["h"],c["left"],c["w"]) for c in P1_["explain"]["cards"]]}; single sticky: delta {P2_["sticky"]["alignDelta"]} px, rect {[(c["top"],c["h"]) for c in P2_["sticky"]["cards"]]}; single figure card ({P2b.get("how")}): {P2b.get("cards")}')
        def tl(name,t):
            if not t: return f'{name}: not tallied'
            return f'{name}: '+'; '.join(f'selection at y={x["y"]}: group {x["toolbar"]} over {[ (c["kind"],"text rects under the group",c["textRectsUnderGroup"],"header px²",c["overHeader"]) for c in (x["overCards"] or [])] or "no card"}' for x in t)
        w('  - standing tally (selection group over an open card\'s body words): '+tl('Explain',P1_.get('tallyExplain'))+' | '+tl('sticky',P2_.get('tallySticky'))+' | '+tl('figure',P2b.get('tallyFigure')))
        def st_(name,t):
            if not t: return f'{name} strip: not tallied'
            return f'{name} strip: '+'; '.join(f'selection at y={x["y"]}: '+(json.dumps(x['strip']) if 'strip' in x else f'no strip (offered {x.get("offered")})') for x in t)
        w('  - standing tally (colour strip after Highlight over the open card): '+st_('Explain',P1_.get('stripExplain'))+' | '+st_('sticky',P2_.get('stripSticky'))+' | '+st_('figure',P2b.get('stripFigure')))
        b3=d['B3']; two=b3['two']
        w(f'  - two cards (sticky opened first, then Explain): kinds/tops/heights {[(c["kind"],c["rect"]["top"],c["rect"]["h"]) for c in two["cards"]]}, height difference {b3["heightDelta"]} px, shared track {two.get("track") and (two["track"]["split"],two["track"]["clientH"],two["track"]["scrollH"])}; paper movement around the second card\'s opening (same paragraph): {json.dumps(b3.get("secondCardPaperMove"))}')
        for k,v in b3['scroll'].items():
            if v.get('present'): w(f'  - {k} body scroll: scroller {v["scroller"]}, hidden content {v["hiddenPx"]} px, overscroll-behavior {v["overscrollBehavior"]}; wheel inside its range: card scrollTop {v["phaseA"]["scrollTop"]}, page scrollY {v["phaseA"]["scrollYBefore"]} → {v["phaseA"]["scrollYAfter"]}; wheel far past the end: page moved {v["phaseB"]["pageMovedPx"]} px')
            else: w(f'  - {k} body scroll: no scroller found')
        w(f'  - minimums at rest: {[(m["kind"],m["cardH"],m["headerH"],m["visibleTextLinesBelowHeader"]) for m in b3.get("minimums",[])]} (kind, card h, header h, visible text lines under the header)')
        b4=d['B4']
        if b4.get('rest'):
            r=b4['rest']
            w(f'  - boundary: strip {r["rect"]["w"]}×{r["rect"]["h"]} px, cursor {r["cursor"]}, rule {r["lineH"]} {r["lineRgb"]} contrast against divider/above/below {r["contrastDivider"]}/{r["contrastAbove"]}/{r["contrastBelow"]}, grip {r["grip"]["w"]}×{r["grip"]["h"]}; cursor probes at 3×3 points of the strip: {sorted(set((p["hit"],p["cursor"]) for p in b4["cursorProbes"]))}; hover rule {b4["hover"]["lineBg"]}; keyboard focus rule {b4["focus"]["lineBg"]}, focus-visible {b4["focus"]["focusVisible"]}; aria {r["now"]} [{r["min"]}–{r["max"]}]')
            w(f'  - keys (card heights): '+', '.join(f'{k} {v["h"]}' for k,v in b4['keys'].items())+'; drags: '+', '.join(f'{k} {b4[k]["h"]}' for k in ('dragMid','drag60','dragFarDown','dragFarUp') if k in b4))
            w(f'  - minimum reached by a far drag down: {[(m["kind"],m["cardH"],m["headerH"],m["bodyBelowHeaderPx"],m["visibleTextLinesBelowHeader"]) for m in b4["minInfoDown"]]}; far drag up: {[(m["kind"],m["cardH"],m["headerH"],m["bodyBelowHeaderPx"],m["visibleTextLinesBelowHeader"]) for m in b4["minInfoUp"]]} (kind, card h, header h, body px, visible text lines)')
            w('  - session: '+'; '.join(f'{k}: {v["kinds"]} {[round(x) for x in v["h"]]}' for k,v in b4['session'].items()))
        else: w('  - boundary: no card divider in this cell')
        for o in d['B5']['orders']:
            th=o['three']
            w(f'  - three cards, opened {o["order"]}, closed {o["closing"]}: stack {th["kinds"]}, heights {[round(x) for x in th["h"]]}, dividers {len(th["divs"])}, shared track {th["track"] and (th["track"]["split"],th["track"]["clientH"],th["track"]["scrollH"])}, figure opened by {o.get("figureHow")}; minimum check {[(m["kind"],m["cardH"],m["visibleTextLinesBelowHeader"],m["headerInsideCard"]) for m in o["min"]]}; controls not hit-testable in view {[(c["kind"],c["notHit"]) for c in o["controls"] if c["notHit"]]}, off-screen {[(c["kind"],c["offscreen"]) for c in o["controls"] if c["offscreen"]]}; after a 50 px drag of the first boundary {o.get("afterDrag")}; closing: {[(c["closed"],[round(x) for x in c["h"]]) for c in o["closeSteps"]]}')
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
    w()

# ---------------------------------------------------------------- B6
w('## B6 — selections and Highlight'); w()
w('Five kinds: (i) inside a paragraph, (ii) across paragraphs (from the last line of one body paragraph to the first line of the next; a heading may stand between them), (iii) in a heading, and in a figure caption, (iv) in the Summary tab, (v) in an answer (needs the placeholder-key profile: an answer exists only for a report that carries the settled question). Each selection is a real mouse drag. For every button offered: Highlight is pressed (marks counted, then removed), Take notes is pressed (a sticky card must open, then deleted), Explain this (key profile) is pressed (an Explain card must open). W4 shows the phone\'s thumb bar instead of the margin group.'); w()
for P in PAPERS:
    w(f'### {P}')
    for f in sorted(glob.glob(R+f'B6-{P}-*-default-light-*.json')):
        d=J(os.path.basename(f)); cell=d['cell']; prof='key' if 'placeholder' in d['profile'] else 'nokey'
        w(f'- **{cell} ({d["profile"]})** — files: `{os.path.basename(f)}`, `B6-<kind>-{cell}-{prof}.png`; load {round(d["load"],1)}')
        for k in d['kinds']:
            if 'error' in k: w(f'  - {k["kind"]}: harness error `{k["error"][:90]}`'); continue
            hl=k.get('highlight') or {}
            w(f'  - {k["kind"]}: selection {json.dumps({a:b for a,b in (k.get("sel") or {}).items() if a in ("len","paragraphs")})}; actions offered {k.get("offered")}; '+(f'Highlight: marks {hl.get("marksBefore")}→{hl.get("marksAfter")}, per paragraph {hl.get("perParagraph")}, fill {hl.get("bg")}, text/fill contrast {(hl.get("contrast") or {}).get("ratio")}, after remove {hl.get("afterRemove")}; ' if hl else '')+f'Take notes: {json.dumps(k.get("takeNotes"))}; Explain: {json.dumps(k.get("explain"))}'+(f'; note: {k.get("note")}' if k.get('note') else ''))
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
    d=J(f'B6chain-{P}-W1-default-light.json')
    if d:
        st=d['steps']
        w(f'- **B6chain-{P}-W1-default-light (no key; the cross-paragraph highlight through reload, colour, remove and the exports)** — files: `B6chain-{P}-W1-default-light.json`, `B6-chain-selection-{P}-W1-default-light.png`, `B6-chain-created-...png`, `B6-chain-notes-...png`, `B6-chain-dark-...png`')
        w(f'  - created: selection {json.dumps(st.get("selection"))}; actions {st.get("offered")}; marks {json.dumps(st.get("created"))}')
        w(f'  - colour from the strip {json.dumps(st.get("stripGreen"))}; notes window {json.dumps(st.get("notes"))}; colour from the notes row {json.dumps(st.get("rowBlue"))}')
        w('  - presets, text colour vs fill, light: '+', '.join(f'{c} {v and v.get("ratio")}' for c,v in st['presetsLight'].items())+' | dark: '+', '.join(f'{c} {v and v.get("ratio")}' for c,v in st['presetsDark'].items()))
        w(f'  - after reload {json.dumps(st.get("reload"))}; notes after reload {json.dumps(st.get("notesAfterReload"))}')
        w(f'  - exports (count of the highlighted passages found in each export / how many): {json.dumps(st.get("exports"))}')
        w(f'  - after remove {json.dumps(st.get("removed"))}; body hash {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}')
    w()
# ---------------------------------------------------------------- B7
w('## B7 — figures'); w()
w('Every figure block of the paper and the left plate is exercised: scrolled into view (the images are lazy), the target\'s centre point hit-tested (the element under the pointer must be the open-figure button), a real left click, then in the margin card: the canvas size, the caption length, focus, `+` / `-` / `Fit` / wheel zoom readouts, a drag (pan), Escape and the close control. A figure block with no image is listed as caption-only with its image request status. Each opened image is compared with its page of the PDF in `pack/B7-compare/` (left: the PDF page rendered at 60 dpi; right: the opened image) — see the observations below.'); w()
for P in PAPERS:
    w(f'### {P}')
    for f in sorted(glob.glob(R+f'B7-{P}-*.json')):
        d=J(os.path.basename(f)); cell=d['cell']
        resp={}
        for r in d['figureResponsesAfter']: resp[r['u']]=r['status']
        w(f'- **{cell}** — files: `{os.path.basename(f)}`, `B7-{cell}-<fig>-open.png`; load {round(d["load"],1)}')
        w(f'  - inventory: {len(d["inventory"])} blocks: '+'; '.join(f'{t["kind"]} {t.get("label")} natural {t.get("imgNat")} page {t.get("page")} fig {t.get("fig")}' for t in d['inventory'])+f'; caption-only blocks (no image): {[(c["capLabel"]) for c in d["captionOnly"]]}; image requests: {json.dumps(resp)}')
        for t in d['targets']:
            ex=t.get('ex') or {}; o=(ex.get('open') or {}); st=o.get('st') or {}; z=ex.get('zoom') or {}
            w(f'  - {t["target"]}: click {json.dumps(t["click"])}; opened {t.get("opened")} in {o.get("ms")} ms; canvas {st.get("canvas")}; caption {st.get("captionLen")} chars; focus in card {ex.get("focusAfterOpen")}; zoom start/in/in/out/Fit/wheel {z.get("start")}/{z.get("zoomIn")}/{z.get("zoomIn2")}/{z.get("zoomOut")}/{z.get("fit")}/{z.get("wheel")}; pan moved {z.get("panMoved")}; Escape closed {ex.get("escapeClosed")}; close control closed {ex.get("closeControlClosed")}'+(f'; error {t["error"]}' if t.get('error') else ''))
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console (not filtered for figure 404s) {[c["text"][:70] for c in d["console"]][:6]}')
    w()
# ---------------------------------------------------------------- B8 / B9 / B10
w('## B8 / B9 / B10 — the answers control, the Submit control, the colours'); w()
for P in PAPERS:
    w(f'### {P}')
    d=J(f'B89steps-{P}-W1-light.json')
    if d:
        w(f'- **B89steps-{P}-W1-light** (every step, one session, placeholder key; control appeared after {d.get("controlAppearedMs")} ms) — files: `B89steps-{P}-W1-light.json`, `B8-steps-{P}-W1-light-s<step>.png` (closed), `-open.png`, `B9-steps-{P}-W1-light-s<step>-edited.png`, `-submitted.png`')
        w(f'  - Submit before any submit: {json.dumps(d.get("initialEmpty"))}; typed: {json.dumps(d.get("typed"))}; submitted: {json.dumps(d.get("submitted"))}')
        for r in d['steps']:
            b=r.get('b8') or {}; h=r.get('b8hover') or {}; f_=r.get('b8focus') or {}
            w(f'  - step {r["scale"]}: control font {b.get("font")} vs Introduction heading {b.get("headingFont")} ({b.get("headingText")}); fill {b.get("bg")} text {b.get("fg")} contrast {b.get("textRatio")}; hover contrast {h.get("textRatio")} (fill {h.get("bg")}); focus ring {json.dumps(f_.get("outline"))} focus-visible {r.get("b8focusVisible")}; first glyph {b.get("startsWith")}; open/closed {r.get("b8open")}/{r.get("b8closed")}; Submit submitted {json.dumps((r.get("b9") or {}).get("submitted"))}; after one more character {json.dumps((r.get("b9") or {}).get("edited"))}; after reverting {json.dumps((r.get("b9") or {}).get("reverted"))}'+(f'; error {r["error"]}' if r.get('error') else ''))
    for f in sorted(glob.glob(R+f'B89-{P}-*.json')):
        d=J(os.path.basename(f)); cell=d['cell']; b8=d['B8']; steps={x['name']:x for x in d['B9']['steps']}
        w(f'- **B89-{cell}** — files: `{os.path.basename(f)}`, `B8-closed|hover|focus|open-{cell}.png`, `B9-typed|submitted|edited|long-{cell}.png`; load {round(d["load"],1)}')
        if b8.get('present'):
            r=b8['rest']; h=b8['hover']; fo=b8['focus']
            w(f'  - answers control: font {r["font"]} vs Introduction heading {r["headingFont"]} ({r["headingTag"]}); fill {r["bg"]}, text {r["fg"]}, contrast {r["textRatio"]}; hover fill {h["bg"]} contrast {h["textRatio"]}; focus ring {json.dumps(fo["outline"])} focus-visible {fo.get("focusVisible")}; triangle {r["hasTriangle"]}; open {b8["opened"]["expanded"]} / closed {b8["closedAgain"]["expanded"]}; Enter → {b8["afterEnter"]}, Space → {b8["afterSpace"]}; panel visible {b8["panel"] and b8["panel"]["visible"]}')
        else: w('  - answers control: not present in this cell')
        for n,sx in steps.items():
            st=sx['state']; w(f'  - Submit state `{n}`: label {st.get("label")}, fill {st.get("bg")}, text {st.get("fg")}, contrast {st.get("textRatio")}, fill vs bar {st.get("boundaryVsBar")}, textarea rows {st.get("taRows")}, API requests since the action {sx.get("newApi")}')
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
    w()

# ---------------------------------------------------------------- B1 extra
w('## B1 (extra probes) — drags in both directions at the largest step and at W3'); w()
for P in PAPERS:
    for f in sorted(glob.glob(R+f'B1x-{P}-*.json')):
        d=J(os.path.basename(f)); w(f'- **B1x-{d["cell"]}** — files: `{os.path.basename(f)}`, `B1x-{d["cell"]}.png`')
        for pn,v in d['panes'].items():
            if not v.get('present'): w(f'  - `{pn}`: no separator'); continue
            w(f'  - `{pn}`: start {v["start"]}; outward 70 px drag: {v["outward"]["before"]} → {v["outward"]["after"]} (aria now {v["outward"]["valueBefore"]} → {v["outward"]["valueAfter"]}); inward 70 px drag: {v["inward"]["before"]} → {v["inward"]["after"]} (aria now {v["inward"]["valueBefore"]} → {v["inward"]["valueAfter"]})')
w()
# ---------------------------------------------------------------- B11
w('## B11 — the P11 guard lines (A1–A12, B1–B12) at W1, default step, light'); w()
w('One cell per paper per half: `GA-<paper>-W1-default-light.json` (A lines) and `GB-<paper>-W1-default-light.json` (B lines); lines that other cells already measure (B5, B7–B11 of P11) point to those cells in the deliverable. A9 / A10 are in the B file (the notes page and the way back).'); w()
for P in PAPERS:
    w(f'### {P}')
    for pre,lab in (('GA','A'),('GB','B')):
        d=J(f'{pre}-{P}-W1-default-light.json')
        if not d: w(f'- {pre}-{P}-W1-default-light: not in the pack'); continue
        w(f'- **{pre}-{P}-W1-default-light** — files: `{pre}-{P}-W1-default-light.json`'+(', `GA12-'+P+'-W1-default-light.png`, `GA12-'+P+'-W1-default-dark.png`' if pre=='GA' else ', `GB2-...png`, `GB3-...png`, `GB4-...png`, `GB6-notes-page-...png`, `GB12-phone-...png`')+f'; profile {d["profile"]}; load {round(d["load"],1)}')
        for k,v in d['lines'].items(): w(f'  - {k}: `{json.dumps(v)[:1400]}`')
        w(f'  - body hash before/after: {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
    w()
# ---------------------------------------------------------------- B12
w('## B12 — entry, Tier 0, 30 action cycles'); w()
for P in PAPERS:
    w(f'### {P}')
    d=J(f'B12entry-{P}-W1-default-light.json')
    if d:
        st=d['steps']
        w(f'- **B12entry-{P}-W1-default-light (fresh no-key profile)** — files: `B12entry-{P}-W1-default-light.json`, `B12-entry-{P}-W1-default-light.png`; load {round(d["load"],1)}')
        w(f'  - upload through the chooser and consent: {json.dumps(st.get("upload"))}; reader ready after {st.get("readerReadyMs")} ms; page: {json.dumps(st.get("page"))}')
        w(f'  - model-shaped POST requests at entry {st.get("modelRequestsAtEntry")} and after the Tier 0 actions {st.get("modelRequestsAtEnd")}; actions: selection {json.dumps(st.get("selection"))}, Highlight {json.dumps(st.get("highlight"))}, sticky {st.get("sticky")}, notes window {st.get("notesWindow")}, Text export downloaded {st.get("exportTxt")}, question {json.dumps(st.get("question"))}, figure opened by {st.get("figure")} → cards {st.get("figureCards")}')
        w(f'  - API requests of the session: {json.dumps(d["requests"]["api"])}; overlay check {json.dumps(d["overlay"])}; body hash {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
    for W in ('W1','W3'):
        d=J(f'B12cycles-{P}-{W}-default-light.json')
        if not d: continue
        cy=d['cycles']
        def cnt(step,cond): return sum(1 for c in cy if cond(c['steps'].get(step)))
        w(f'- **B12cycles-{P}-{W}-default-light** — files: `B12cycles-{P}-{W}-default-light.json`, `B12-cycles-end-{P}-{W}-default-light.png`; {len(cy)} of {d["cyclesPlanned"]} cycles; load at start {round(d["load0"],1)}')
        w(f'  - cycles with a step error: {sum(1 for c in cy if any(isinstance(v,dict) and "error" in v for v in c["steps"].values()))}; page errors {len(d["pageerrors"])} (per cycle {[c["pageErrorsNew"] for c in cy]}); console errors beyond the known noise {len(d["consoleErrors"])}; "Maximum update depth" in the console {d["maxUpdateDepthInConsole"]}; overlay after each cycle {sorted(set(json.dumps(c["overlay"]) for c in cy))}; final overlay {json.dumps(d["finalOverlay"])}')
        w(f'  - per cycle (ms): {[c["ms"] for c in cy]}; Highlight marks after press: {[ (c["steps"].get("highlight") or {}).get("marks") for c in cy]}; cards after Explain/sticky/figure: {[ ((c["steps"].get("explain"), c["steps"].get("sticky"), (c["steps"].get("figure") or {}).get("cards"))) for c in cy[:3]]} (first three cycles); divider drag: {[ (c["steps"].get("dragDivider") or {}).get("kind") for c in cy[:4]]}..., changed {sum(1 for c in cy if (c["steps"].get("dragDivider") or {}).get("changed") or (isinstance(c["steps"].get("dragDivider"),dict) and c["steps"]["dragDivider"].get("before")!=c["steps"]["dragDivider"].get("after")))}; cards left after close-all {sorted(set(json.dumps(c["steps"].get("closeAll")) for c in cy))}; body hash {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}')
    w()
open(R+'index.md','w').write('\n'.join(out)+'\n')
print('lines',len(out))
