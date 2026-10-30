"""Score reading-map structures against the ruled truth, stored only as hashes (no word of a paper).

  score-structure.py c0 <P> <map.json>            one map from map-dump.test.ts (C0, no key)
  score-structure.py c1 <P> <dump.json> [...]     keyed runs from the C1 harness (sealed-c1/<P>-<phase>run<k>.json)

A part PASSes when the row whose first paragraph starts with the part's locator (normalized, first 40
characters; compared by sha256) carries the ruled role. C1 also lists rows unlike the current C0 map
(heading hash, role, level) for the director's extra review. C1 is 100 % per paper: every part, every run.
"""
import hashlib, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
norm = lambda s: re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s or "").replace("­", "")).strip().lower()
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
mode, P, files = sys.argv[1], sys.argv[2], sys.argv[3:]
truth = json.load(open(os.path.join(HERE, "truth-hashed.json")))[P]
ref = {(r["h"], r["role"], r["level"]) for r in json.load(open(os.path.join(HERE, "c0-rows-hashed.json")))[P]}


def score(rows):
    for k, r in enumerate(rows):
        r.setdefault("i", k)

    def first_para(r):
        if r.get("paragraphs"):
            return r["paragraphs"][0]
        for q in rows[r["i"] + 1:]:
            if q["level"] <= r["level"]:
                return ""
            if q.get("paragraphs"):
                return q["paragraphs"][0]
        return ""

    passes, starts, lines = 0, set(), []
    for part in truth:
        hit = [r for r in rows if first_para(r) and sha(norm(first_para(r)).lstrip("s")[: part["n"]]) == part["sha256"]]
        r = hit[0] if hit else None
        ok = bool(r) and r["role"] == part["role"]
        passes += ok
        if r:
            starts.add(r["i"])
        lines.append(f"  part {part['role']:14s} {'PASS' if ok else 'FAIL'}  " + (f"row {r['i']} L{r['level']} role={r['role']}" if r else "start not found"))
    new = [r for r in rows if r["i"] not in starts and (sha(norm(r.get("heading"))), r["role"], r["level"]) not in ref]
    return passes, lines, new


for f in files:
    d = json.load(open(f))
    rows = d.get("rows", [])
    p, lines, new = score(rows)
    print(f"{os.path.basename(f)}: PASS {p} / {len(truth)} strict; rows {len(rows)}" + (f"; structure {d.get('structure', {}).get('status') if isinstance(d.get('structure'), dict) else None}" if mode == "c1" else "") + f"; rows unlike C0 (review as extras): {len(new)}")
    for l in lines:
        if mode == "c0" or "FAIL" in l:
            print(l)
    for r in new:
        print(f"    new row {r['i']} L{r['level']} role={r['role']}")
