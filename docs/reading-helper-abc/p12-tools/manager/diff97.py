import json, re, difflib, sys
def load(p, tag):
    d = json.load(open(f"out/{p}-{tag}.json")); return d["rows"]
def short(s): s=s.strip(); return len(s) < 60 and not re.search(r"[.!?:;)\]]$", s)
for P in ["P1","P2","P3","P4","P5","P6"]:
    a, b = load(P,"pre97"), load(P,"post97")
    same_rows = [(r["role"], r["canonical"], r["level"]) for r in a] == [(r["role"], r["canonical"], r["level"]) for r in b]
    pa = [x for r in a for x in r["paragraphs"]]; pb = [x for r in b for x in r["paragraphs"]]
    wa = " ".join(pa).split(); wb = " ".join(pb).split()
    sm = difflib.SequenceMatcher(None, wa, wb, autojunk=False)
    dele = []; ins = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op in ("delete", "replace"): dele.append(wa[i1:i2])
        if op in ("insert", "replace"): ins.append(wb[j1:j2])
    dw = sum(len(x) for x in dele); iw = sum(len(x) for x in ins)
    # suspicious deletions: runs with >= 6 words of which >= 5 alphabetic lowercase words of 3+ letters, or a sentence end after a word
    sus = [x for x in dele if sum(1 for w in x if re.fullmatch(r"[a-z]{3,}[,.;:]?", w)) >= 5]
    print(f"{P}: rows same={same_rows} paras {len(pa)}->{len(pb)} short {sum(map(short,pa))}->{sum(map(short,pb))} | deleted runs {len(dele)} words {dw} | inserted runs {len(ins)} words {iw} | prose-like deleted runs {len(sus)} (max len {max([len(x) for x in sus], default=0)})")
    json.dump({"sus":[" ".join(x) for x in sus], "ins":[" ".join(x) for x in ins]}, open(f"out/diff97-{P}.json","w"))
