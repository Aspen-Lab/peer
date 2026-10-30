import re, sys
rep = open(sys.argv[1], encoding="utf8").read().lower()
rw = re.findall(r"[a-z0-9]+", rep)
rg = {" ".join(rw[i:i+4]) for i in range(len(rw)-3)}
pap = sys.stdin.read().lower()
pw = re.findall(r"[a-z0-9]+", pap)
pg = {" ".join(pw[i:i+4]) for i in range(len(pw)-3)}
hit = sorted(rg & pg)
print("paper 4-grams", len(pg), "report 4-grams", len(rg), "shared", len(hit))
for h in hit[:40]: print("  shared:", h)
