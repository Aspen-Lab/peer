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
w('# Evidence pack index — P12-92 (Theme B, round 4, fresh walk on the landed head after C P12-89)')
w()
w('Head walked `d2d2b8b4c1ed47f2c3b8cdd2e4cf44797df36434` (branch `update-on-paper-digest`, detached worktree). Chromium only (Playwright, headless, device scale 1, CSS-viewport emulation; no real browser zoom). Server: the dev server with the model stub (`env -u PEER_TEST_GEMINI_API_KEY npx next dev -p 4247`; the container restarted once during the walk, the server and the later cells ran again on the same uploads directory; the first server\'s log is `dev-1.log`). Papers: the owner\'s P1 (10 pp.), P2 (10 pp.), P3 (11 pp.), each entered only through the app\'s file chooser and consent. This index lists observations and file names only; it carries no score and no verdict.')
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
w('Rule found in the code: `web/src/components/reader/reader-layout.tsx` `useSpread()` (lines 122–126) compares `documentElement.clientWidth` with `railMinimumWidth(scale)` in `web/src/components/reader/pane-layout.ts` (lines 199–207) = 48 (rail) + 280 (margin minimum) + 24 (two dividers) + ceil(476 × scale + 24); below it the page is one column with a bottom-docked margin (`responsive-margin.tsx`); ruling §1h.197.'); w()
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
w('Every figure block of the paper (Paper digestion tab) and the Summary tab\'s "Enlarge figure" thumbnail is exercised: scrolled into view (the images are lazy), the target\'s centre point hit-tested (the element under the pointer must be the open-figure button), a real left click, then in the margin card: the canvas size, the caption length (the card\'s caption against the same figure\'s inline caption), the caption box\'s client / scroll height, focus, `+` / `-` / `Fit` / wheel zoom readouts, a drag (pan), Escape and the close control. Image requests are listed per click with their status. A second view of the first figure follows. Each opened image is paired with its PDF page in `pair/` (the card\'s image box on the left, the page rendered with `pdftoppm -r 60` on the right; pages in `pdfpages/`).'); w()
for P in PAPERS:
    w(f'### {P}')
    for f in sorted(glob.glob(R+f'B7-{P}-*.json')):
        d=J(os.path.basename(f)); cell=d['cell']
        resp={}
        for r in d['figureResponsesAfter']: resp[r['u']]=r['status']
        w(f'- **{cell}** — files: `{os.path.basename(f)}`, `B7-{cell}-<fig>-open.png`, `B7-{cell}-summary0-open.png`; load {round(d["load"],1)}')
        w(f'  - inventory: {len(d["inventory"])} blocks: '+'; '.join(f'{t["kind"]} {t.get("label")} natural {t.get("imgNat")} page {t.get("page")} fig {t.get("fig")} inline caption {t.get("bodyCapLen")} chars' for t in d['inventory'])+f'; caption-only blocks (no image): {[(c["capLabel"]) for c in d["captionOnly"]]}; image responses of the whole cell: {json.dumps(resp)}')
        for t in d['targets']:
            ex=t.get('ex') or {}; o=(ex.get('open') or {}); st=o.get('st') or {}; z=ex.get('zoom') or {}
            w(f'  - {t["target"]}: click {json.dumps(t["click"])}; opened {t.get("opened")} in {o.get("ms")} ms; card {st.get("rect")}, canvas {st.get("canvas")}; caption in card {st.get("captionLen")} chars (starts "{st.get("capHead")}"), caption box client/scroll height {st.get("capClientH")}/{st.get("capScrollH")} ({st.get("capOverflowY")}); card header starts "{(st.get("headerText") or "")[:10]}"; focus in card {ex.get("focusAfterOpen")}; zoom start/in/in/out/Fit/wheel {z.get("start")}/{z.get("zoomIn")}/{z.get("zoomIn2")}/{z.get("zoomOut")}/{z.get("fit")}/{z.get("wheel")}; pan moved {z.get("panMoved")}; Fit resets transform {z.get("fitResetsTransform")}; Escape closed {ex.get("escapeClosed")}; close control closed {ex.get("closeControlClosed")}; image requests during this click {t.get("figureImageRequests")}; error {t.get("error")}')
        sm=d.get('summary') or {}
        w(f'  - Summary tab: visible "Enlarge figure" buttons {sm.get("visibleEnlargeButtons")}; '+'; '.join(f'#{x.get("i")} box {x.get("box")} hit {json.dumps(x.get("where"))} opened in the margin {x.get("openedInMargin")} lightbox {x.get("lightbox")} card {json.dumps(x.get("card"))} Escape closed {x.get("escapeClosed")} image requests {x.get("figureImageRequests")}' for x in sm.get('targets',[]))+f'; error {sm.get("error")}')
        w(f'  - second view of the first opened figure: {json.dumps(d.get("secondView"))}; controls named Supplementary / Extended Data: {d.get("supplementaryControls")}; Extended Data entries in the inventory: {d.get("extendedDataInventory")}')
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

# ---------------------------------------------------------------- extra sections (added in round 2)
w('## ENTRY — the upload through the file chooser, and when the body arrives (C P12-58)'); w()
d=J('ENTRY-upload-timeline.json')
if d:
    for P,t in d['timeline'].items():
        w(f'- **{P}** (first upload in a fresh no-key profile, three papers one after the other): the page stayed on the reader URL, navigations after the upload {t["navigationsAfterUpload"]}; body length samples (ms, characters) {t["firstBodyLenSamples"]}; last sample {t["final"]}; seconds until the length was stable for 3 samples {t["secondsToStableBody"]}; requests after the upload {json.dumps(t["requestCounts"])}; load {round(t["load"],1)}')
    w(f'- page errors {len(d["pageerrors"])}; console {[c["text"][:70] for c in d["console"]][:4]}')
w()
w('## CLAIMS — structure requests with no key (C P12-53), the map rows\' role tags and the body\'s first block (C P12-63), Supplementary / Extended Data controls (C P12-56)'); w()
for P in PAPERS:
    for prof in ('nokey','key'):
        d=J(f'CLAIMS-{P}-W1-default-light-{prof}.json')
        if not d: continue
        w(f'- **CLAIMS-{P}-W1-default-light-{prof}** — files: `CLAIMS-{P}-W1-default-light-{prof}.json`, `.png`; idle 20 s after load; `/structure` requests {len(d["structureRequests"])} {d["structureRequests"]}; all API requests {json.dumps(d["allApiRequests"])}; map rows {len(d["rows"])} with role tags {d["roleTags"]}; row levels {[r["level"] for r in d["rows"]]}; the body\'s first block is a heading {d["firstBlockIsHeading"]} (tag {d["firstBlock"]}); body headings {len(d["heads"])}, each checked against the PDF text (verdict only): heading appears as a PDF line {[h["asPdfLine"] for h in d["heads"]]}; controls named Supplementary / Extended Data {d["supplementaryControls"]}; page errors {len(d["pageerrors"])}')
w()
w('## E1 probe — the fixed "Open your notes" tab against the fixed key legend and the viewport'); w()
for f in sorted(glob.glob(R+'E1-P*.json')):
    d=J(os.path.basename(f))
    for st in ('noCard','stickyOpen'):
        x=d[st]; t=x['tab']; lg=x['legend']
        w(f'- **{d["cell"]} ({st})** — files: `{os.path.basename(f)}`, `E1-{d["cell"]}-{"nocard" if st=="noCard" else "sticky"}.png`; tab x/y/w/h {t and (t["x"],t["y"],t["w"],t["h"])}, below the viewport {t and t["belowViewport"]} px; legend y/h {lg and (lg["y"],lg["h"])}; tab ∩ legend {x["overlap"]}; legend text rects under the tab {x["legendTextRectsUnderTab"]}')
w()
w('## B1 hit strip — every point along each pane divider\'s whole length (y every 20 px, three x positions)'); w()
for f in sorted(glob.glob(R+'B1hit-P*.json')):
    d=J(os.path.basename(f))
    w(f'- **B1hit-{d["cell"]}** — files: `{os.path.basename(f)}`, `.png`; '+'; '.join(f'divider `{k}` rect {v["rect"]}: {v["hit"]} of {v["total"]} points hit the divider, blocked at y {v["blockedYRange"]} by {v["blockedBy"]}, cursors {v["cursors"]}' for k,v in d['dividers'].items()))
w()
w('## A2 / A11 supplement — the rail\'s peek with a real mouse (W1 after Collapse, W2 as the forced rail)'); w()
for f in sorted(glob.glob(R+'A2peek-P*.json')):
    d=J(os.path.basename(f))
    for W in ('W1','W2'):
        r=d[W]
        w(f'- **{d["cell"]} {W}** — files: `{os.path.basename(f)}`, `A2peek-{d["input"]}-{W}-default-light.png`; collapsed {r["collapsed"]}; peek after {r["peekAfterMs"]} ms of the pointer on the rail; during the peek {r["duringPeek"]}; after the pointer left (1.5 s) {r["afterLeave"]}; after a tab press inside the peek and the pointer away {r["afterTabPressAndLeave"]}; after Escape {r["afterEscape"]}; page errors {len(r["pageerrors"])}')
w()
w('## B8 on the phone (W4) — the answers control scrolled into view, a real click'); w()
for f in sorted(glob.glob(R+'B8phone-P*.json')):
    d=J(os.path.basename(f))
    w(f'- **B8phone-{d["cell"]}** — files: `{os.path.basename(f)}`, `B8phone-{d["cell"]}-closed.png`, `-open.png`; control found {d.get("controlFound")}; closed {d.get("rest")}; after a click {d.get("afterClick")}; after a second click {d.get("afterSecondClick")}; Enter then Enter again: {d.get("afterEnter")} / {d.get("afterEnter2")}; page errors {len(d.get("pageerrors",[]))}')
w()
w('## P12-36\'s case — the same note in the sticky card and the notes window, edits in alternation (W1)'); w()
for f in sorted(glob.glob(R+'P1236-P*-W1-*.json')):
    d=J(os.path.basename(f))
    w(f'- **P1236-{d["cell"]}** — files: `{os.path.basename(f)}`, `.png`; typed `base words` then ` s1`, ` w1`, ` s2`, ` w2` (alternating, 1.3 s apart), Save in the card, ` w3` in the window, reload; steps {[(s["label"],s["window"],s["sticky"]) for s in d["steps"]]}; after reload the window shows {json.dumps(d["final"])}; missing {d["verdict"]["missing"]}, repeated {d["verdict"]["duplicated"]}; page errors {len(d["pageerrors"])}')
w()
w('## E3 probe — the letter case of acronyms on every surface that shows its words (C P12-83)'); w()
for f in sorted(glob.glob(R+'E3-P*.json')):
    d=J(os.path.basename(f))
    w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`; the acronyms SE, LCO, DFT, LYC and "Li-" counted per surface in their printed case and in any other case, and the same counts in the PDF\'s own text (read in place); surfaces (characters, tokens whose case differs from every form the PDF prints, acronym-shaped such tokens): '+'; '.join(f'{n} ({v["chars"]} chars, {v["flaggedDistinct"]} distinct, shaped {v["shapedFlags"]}, counts {json.dumps(v["targets"])})' for n,v in d['surfaces'].items())+f'; PDF counts {json.dumps(d["pdfTargets"])}; card captions that begin in lower case: {[x["i"] for x in d["cardCaptionFirstLower"] if x["firstCharLower"]]}')
w()
w('## Card captions against the PDF (B7)'); w()
d=J('CAPFID.json')
if d:
    for P,v in d.items():
        w(f'- **{P}** — file `CAPFID.json`; per figure: card caption length, whether its last 40 characters occur in the PDF\'s text, the PDF span in characters from the caption\'s start to that ending where both were found, whether it ends at a sentence end: '+'; '.join(f'#{x["i"]+1}: {x["appLen"]} chars, tail found {x["tailFound"]}, span {x["pdfSpan"]}, ends a sentence {x["endsSentence"]}' for x in v))
w()
w('## The notes tab against the margin pane divider, with a sticky card open')
w()
for f in sorted(glob.glob(R+'TABDIV-P*.json')):
    d=J(os.path.basename(f))
    w(f'- **{d["cell"]}** — files: `{os.path.basename(f)}`, `.png`; tab (no card) {d["noCard"]["tab"]}; tab (sticky open) {d["sticky"]["tab"]}; margin divider {(d.get("overlapWithMarginDivider") or {}).get("divider")}; tab ∩ divider {d.get("overlapWithMarginDivider")}; element under five points down the tab at the divider\'s centre line: {[(q["onDivider"], q["tag"], q["cursor"]) for q in d.get("probesAtDividerCentre",[])]}')
w()
w('## A real drag on the margin divider with a sticky card open — at the tab\'s height and clear of it'); w()
for f in sorted(glob.glob(R+'TABDRAG-P*.json')):
    d=J(os.path.basename(f))
    w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`; tab {d["tab"]}; divider {d["sep"]}; drag at the tab\'s height: {d["atTabHeight"]}; drag clear of the tab: {d["clearOfTab"]}')
w()
w('## The reading place through W1, W3, W1, W4, W1 (a paragraph at the masthead)'); w()
for f in sorted(glob.glob(R+'PLACE-P*.json')):
    d=J(os.path.basename(f)); w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`; {d["note"]}; snapshots {json.dumps(d["snapshots"])}')
w()
w('## B8 on P3 at W4 — the control against the body\'s headings'); w()
d=J('B8p3w4-P3-W4-default-light.json')
if d: w(f'- **B8p3w4-P3-W4-default-light** — file `B8p3w4-P3-W4-default-light.json`; control font {d["control"]}; first body heading {d["firstHeading"]}; second heading {d["secondHeading"]}; headings {d["nHeadings"]}')
w()
w('## A lone card after the others close (B5)'); w()
for f in sorted(glob.glob(R+'LONE2-P*.json')):
    d=J(os.path.basename(f)); w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`, screenshots `LONE2-<paper>-W1-drag<false|true>.png`; '+'; '.join(f'drag {r["drag"]}: three cards {r["three"]}, steps {r["steps"]}, final {r["final"]}' for r in d['runs']))
w()
w('## Served figure images (B7)'); w()
w('`figimg/<paper>-fig<N>-p<page>.png`: each inline figure image as the app serves it (the route\'s answer), saved by the walk\'s page context; `pair/<paper>-fig<N>-vs-page<NN>.png` puts it beside its PDF page; `pair/P3-fig4-top.png` is the top 60 pixel rows of Fig. 4\'s image (rows 0 to 12 and the first columns are pure white).')
w()
w('## PDF pages and pairing sheets (B7)'); w()
w('`pdfpages/<paper>-page<N>-<NN>.png`: the pages of the owner\'s PDFs (read in place) that carry a figure, rendered with `pdftoppm -r 60` (P1 pages 2, 3, 5, 6, 7, 8; P2 pages 2, 3, 4, 5, 7, 8; P3 pages 2 to 9). `pair/<paper>-fig<N>-vs-page<NN>.png`: the served image of figure N beside its page. These sheets are screenshots of the paper and stay in private scratch.')

# ---------------------------------------------------------------- round-4 sections
w('## R4TAB — the notes tab beside 1, 2 and 3 open cards (E5, C P12-89)'); w()
w('Cards opened in the order sticky, Explain, figure (one card: no-key profile; two and three: the placeholder-key profile, because Explain needs a model). The tab is the fixed "Open your notes" button. Hit columns are the pixel columns whose centre point resolves to the tab or to the divider (`elementFromPoint` has about 1 px of slop at element edges, so a hit column can lie 1 px outside its element\'s rect). Text gap = the tab\'s first hit column minus the right edge of the nearest paper text rect within the tab\'s vertical band, at four scroll positions.'); w()
for f in sorted(glob.glob(R+'R4TAB-P*.json')):
    d=J(os.path.basename(f)); b=d['withCards']['base']; cell=d['cell']
    if not b.get('tab'): w(f'- **{cell}** — file `{os.path.basename(f)}`: no tab found'); continue
    t=b['tab']; sc=d.get('scan',{})
    drags='; '.join(f'{k[4:]} y={v["y"]}: {v["marginBefore"]}→{v["marginAfter"]} cursor {v["hover"] and v["hover"]["cursor"]}' for k,v in d.items() if k.startswith('drag'))
    w(f'- **{cell}** ({d["profile"]}) — files: `{os.path.basename(f)}`, `{cell}.png`, `{cell}-tabzoom.png`; load {round(d["load"],1)}')
    w(f'  - cards open {d["cardsOpen"]} (rects {d["cardRects"]}); tab face x/y/w/h {(t["x"],t["y"],t["w"],t["h"])}; hit columns {b["hit"]}; margin divider rect {b["strip"]}, its hit columns {b.get("stripHit")}; face-to-strip gap {b["gapFaceToStrip"]} px, hit-to-strip-hit gap {b.get("hitGapToStripHit")}; face ∩ strip {b["overlapFaceStrip"]} px², hit ∩ strip {b["overlapHitStrip"]} px²')
    w(f'  - overlap of the face / hit span with each card and its header (px²): {[(c["kind"],c["face"],c["hit"],c["faceHeader"],c["hitHeader"]) for c in b["overlapCards"]]}; masthead {b["overlapMasthead"]}; legend {b["overlapLegend"]}; tab bottom to legend top {b["tabBottomToLegendTop"]} px; centre padding {b["centre"] and (b["centre"]["paddingLeft"],b["centre"]["paddingRight"])}')
    w(f'  - paper text in the tab\'s band at four scroll positions: text rects {[x.get("textRectsInTabBand") for x in d["withCards"]["text"]]}, nearest text right edge {[x.get("maxTextRight") for x in d["withCards"]["text"]]}, tab first hit column minus that edge {[x.get("gapTextToHit") for x in d["withCards"]["text"]]}, face minus edge {[x.get("gapTextToFace") for x in d["withCards"]["text"]]}; non-text blocks (figure, table, image) {[ (x.get("blockKind"),x.get("gapBlockToHit")) for x in d["withCards"]["text"]]}')
    w(f'  - elements under the tab\'s rect (samples): {d["withCards"]["under"]}')
    w(f'  - strip scan with the cards open (y every 20 px, five x positions): margin {sc.get("margin") and (sc["margin"]["colresize"],"col-resize of",sc["margin"]["total"],"blocked",sc["margin"]["nBlocked"],sc["margin"]["blocked"][:3],sc["margin"]["cursors"])}; left {sc.get("left") and (sc["left"]["colresize"],"of",sc["left"]["total"],sc["left"]["nBlocked"])}')
    w(f'  - real drags on the margin divider (dx -60 then +60 at each height): {drags}; a press on the tab opens the notes window: {d.get("tabPress")}')
    w(f'  - body hash before/after {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}; console {len(d["console"])}')
w()
w('## R4STRIP — the pane dividers\' strips against the key legend (C P12-89 rule 2)'); w()
for f in sorted(glob.glob(R+'R4STRIP-P*.json')):
    d=J(os.path.basename(f)); cell=d['cell']
    w(f'- **{cell}** — file `{os.path.basename(f)}`, `{cell}-<state>-<top|mid|end>.png`; Fit {d["fit"]}; step {d["step"]}; load {round(d["load"],1)}')
    for st,v in d['states'].items():
        for lab,o in v.items():
            w(f'  - {st}, scroll {lab} (scrollY {o["scrollY"]} of {o["maxScroll"]}): page zoom {o["pageZoom"]}, legend top {o["legend"] and o["legend"]["top"]} (h {o["legend"] and o["legend"]["h"]}), masthead bottom {o["mastheadBottom"]}; '+'; '.join(f'divider `{p}` top {x["top"]} bottom {x["bottom"]} (bottom − legend top {x["bottomMinusLegendTop"]}; last y that hits it − legend top {x["lastHitMinusLegendTop"]}; top − masthead bottom {x["topMinusMastheadBottom"]})' for p,x in o['dividers'].items()))
    w(f'  - body hash before/after {d["hashBefore"]["sha"]} / {d["hashAfter"]["sha"]}; page errors {len(d["pageerrors"])}')
w()
for f in sorted(glob.glob(R+'R4TOP-P*.json')):
    d=J(os.path.basename(f)); w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`; where the left pane, the strips and the margin start at scroll 0 and mid-page: {json.dumps(d["states"])}')
w()
w('## R4CPL — characters per full line of body paragraphs after the 20 px right padding'); w()
w('`first4` = the first four body paragraphs over 400 characters (round 3\'s selection); `all` = every body paragraph over 300 characters outside figures. "emulated 12 px" = the same page with an injected style putting the centre\'s right padding back to 12 px (round 3\'s geometry), measured on the same paragraphs in the same cell.'); w()
for f in sorted(glob.glob(R+'R4CPL-P*.json')):
    d=J(os.path.basename(f)); cell=d['cell']
    def q(o): return f'paragraph width {o["paragraph"] and o["paragraph"]["w"]} px, first4 {o["first4"]}, all {o["all"]}'
    w(f'- **{cell}** — file `{os.path.basename(f)}`, `{cell}.png`, `{cell}-pad12emu.png`; mode {d["mode"]}, centre {d["centre"] and d["centre"]["w"]} px, padding {d["paddingLeft"]} / {d["paddingRight"]}, body font {d["bodyFont"]}; 20 px (as built): {q(d)}; emulated 12 px: {q(d["emulatedPad12"])}; horizontal overflow {d["hOverflow"]}')
w()
w('## O5 / O6 / O7 / O8 — observations carried from earlier rounds (counts and geometry only)'); w()
for f in sorted(glob.glob(R+'O568-P*.json')):
    d=J(os.path.basename(f)); cell=d['cell']
    w(f'- **{cell}** — file `{os.path.basename(f)}`, `O5-<paper>-W3-default-light.png`, `O5-<paper>-W3-withcard-default-light.png`, `O7-<paper>-<W>-default-light.png`')
    w(f'  - O6 (text pipeline counts, W1): {json.dumps(d["O6"])}')
    o8=d["O8"]; w(f'  - O8 (map rows and the words each holds): rows with links {o8.get("rowsWithLinks")}, resolved {o8.get("rowsResolved")}, top-level rows {o8.get("topLevelRows")}, words per top-level row {o8.get("topLevelWords")}, last row {o8.get("lastRowWords")}, largest row {o8.get("maxRowWords")}, body words {o8.get("bodyWords")}')
    for wn in ('W1','W3'):
        w(f'  - O7 ({wn}): the note tag buttons and the characters either side: {json.dumps(d.get("O7_"+wn))}')
    for k in ('O5_W3','O5_W3_withCard'):
        o=d.get(k)
        if o: w(f'  - O5 ({k}): notes window {o.get("win")} ({o.get("winHeightShareOfViewport")} of the viewport), toolbar {o.get("toolbar")}, scroller {o.get("scroller")}, rows and their visibility {[ (r["h"], r["vis"]) for r in o.get("rowList",[])]}'+(f', cards {o.get("cards")}' if o.get("cards") else ''))
    w(f'  - page errors W1 {len(d.get("pageerrors_W1",[]))}, W3 {len(d.get("pageerrors_W3",[]))}')
w()

w('## PLACEPROBE — the W1 → W4 → W1 reading place with no card, with two cards, with two cards and typed drafts (P2)'); w()
d=J('PLACEPROBE-P2.json')
if d:
    for k,r in d['variants'].items():
        w(f'- **{k}** — file `PLACEPROBE-P2.json`; paragraph 9 at the start {json.dumps(r["start"]["p9"])} (scrollY {r["start"]["scrollY"]}), at W4 {json.dumps(r["atW4"]["p9"])} (scrollY {r["atW4"]["scrollY"]}), back at W1 after 2 s {json.dumps(r["back2s"]["p9"])} (scrollY {r["back2s"]["scrollY"]}), after 8 s {json.dumps(r["back8s"]["p9"])} (scrollY {r["back8s"]["scrollY"]}); paragraph 8 / 10 at the start {json.dumps(r["start"]["p8"])} / {json.dumps(r["start"]["p10"])}')
w()
w('## Re-runs and the container restarts (facts only)'); w()
w('- The container restarted twice during the walk; the dev server was started again with the same command and the same uploads directory each time (server logs `dev-1.log`, `dev-2.log`, `dev.log`), and every cell without a complete JSON was run again. Cells whose first run was made under a machine load of 4 to 10 and which were run again on a quiet machine: `B2-P2-default-light` (first run: the largest-step breakpoint read 1213 px against 1138 in the other two papers and in the second run), `GB-P1-W1-default-light` and `GB-P3-W1-default-light` (first run: the Summary tab\'s place before the action read scrollY 207 against 1462 after; second run equal). `B345-P1-W1-smallest-light`: the B5 phase was run again with another paragraph (`PARA_OFFSET=1`); the first run\'s three selection time-outs are kept in the cell\'s `errors`. The 27 `R4TAB-*-default-light` cells were run twice: the first run took the body-text hash before the cards were closed (the note tags change the hash), the second after.')
w()

w('## TABCTL — the notes tab as a control (name, label contrast, hover, keyboard focus, Enter), one sticky card open'); w()
for f in sorted(glob.glob(R+'TABCTL-P*.json')):
    d=J(os.path.basename(f)); cell=d['cell']; r=d['rest']
    w(f'- **{cell}** — files: `{os.path.basename(f)}`, `{cell}-focused.png`; accessible name {r["accessibleName"]!r}, visible text {r["text"]!r}, rect {r["rect"]}; label {r["label"]}; fill {r["fillRgb"]}; border {r["borderRgb"]} against the page beside it {r["borderVsOutside"]} : 1; hover label {d["hover"]["label"]}; keyboard: reached {d["keyboard"]["reached"]} after {d["keyboard"]["tabPresses"]} Tab presses; focused: focus-visible {d.get("focused",{}).get("focusVisible")}, outline {d.get("focused",{}).get("outline")}; Enter opens the notes window {d.get("enterOpensNotes")}; page errors {len(d["pageerrors"])}')
w()
w('## LONGSEL — long selections in the body (real click, then shift-click), Tier 0'); w()
d=J('LONGSEL.json')
if d:
    for r in d['runs']: w(f'- {r["key"]} {r["wn"]} {r["area"]}: selection across {r["spanParagraphs"]+1} paragraphs, {r["selLen"]} characters: actions offered {r["offered"]}')
for f in sorted(glob.glob(R+'LONGSEL2-*.json')):
    d=J(os.path.basename(f)); w(f'- **{d["cell"]}** — file `{os.path.basename(f)}`, `LONGSEL2-<paper>-span<N>.png`: '+'; '.join(f'span {r["span"]}: {r["len"]} characters, figure blocks in the range {r["figuresInRange"]}, buttons in the range {r["controlsInRange"]}, toolbar {r["toolbar"]}, live-region text {r["hints"]}' for r in d['runs']))
w()
w('## O7b — where the note tag stands when the selection ends inside a word (three paragraphs per paper, W1 default light)'); w()
d=J('O7b-all-W1-default-light.json')
if d:
    for P,rec in d['papers'].items(): w(f'- **{P}** — files `O7b-all-W1-default-light.json`, `O7b-{P}-p<5|6|7>-W1-default-light.png`; '+'; '.join(f'paragraph {k}: selection end inside a word {v.get("selEnd",{}).get("endInsideWord")} ({v.get("selEnd",{}).get("len")} characters), tag button count {len(v.get("tag") or [])}' for k,v in rec.items()))
w()
txt='\n'.join(out)+'\n'
txt=re.sub(r'(Open Fig(?:ure)? \d+) in the margin',r'\1 (margin)',txt)
open(R+'index.md','w').write(txt)
print('lines',len(out))
