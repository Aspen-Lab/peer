# usage: python3 mut.py NAME FILE(rel web/) OLDFILE NEWFILE TEST [TEST...]
# applies one mutation in V, runs the tests, restores byte-identical, reports red count and sha equality
import sys, hashlib, subprocess, pathlib, shutil, re
V = pathlib.Path("__P12_SCRATCH__/p504/wt/web")
D = pathlib.Path(__file__).parent
name, rel, oldf, newf, *tests = sys.argv[1:]
f = V / rel; old = open(oldf).read(); new = open(newf).read()
before = hashlib.sha256(f.read_bytes()).hexdigest(); bak = D / (name + ".bak"); shutil.copyfile(f, bak)
s = f.read_text(); assert s.count(old) == 1, f"old occurs {s.count(old)}x"
f.write_text(s.replace(old, new))
try:
    r = subprocess.run(["npx", "vitest", "run", "--maxWorkers=2", *tests], cwd=V, capture_output=True, text=True, env={**__import__('os').environ, "TZ": "America/Chicago"}, timeout=900)
    out = r.stdout + r.stderr
finally:
    shutil.copyfile(bak, f)
after = hashlib.sha256(f.read_bytes()).hexdigest()
(D / (name + ".out")).write_text(out)
m = re.findall(r"Tests\s+(.*)", out); fails = re.findall(r"FAIL\s+(.*)", out)
print(name, "|", m[-1] if m else "no summary", "| sha equal" if before == after else "| SHA DIFFERS")
for x in sorted(set(fails))[:12]: print("   ", x[:170])
