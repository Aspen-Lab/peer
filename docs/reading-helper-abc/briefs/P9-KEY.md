# P9-KEY — the key session: the model-backed features tested end to end with the owner's Gemini test key (round P9, the reading-quality loop; the owner 17:0xZ 2026-10-11: "AI api key的功能是一定要测试的"; the key is in the environment variable `PEER_TEST_GEMINI_API_KEY` since 20:1xZ)

Role: the tester of the keyed features — a separate cloud session in the same environment, created by the manager session (`session_017DGPdGJqr95t3pMMcspXjE`, Claude Fable) because only a new session reads a newly added environment variable. Model: Claude Sonnet. You have your own container with the repository checked out at `deep-report-reading-helper-enhancement`. You report to the manager with `mcp__claude-code-remote__send_message` (session_id `session_017DGPdGJqr95t3pMMcspXjE`); the owner (Peter, writes Chinese) may also read this session and drop a PDF into it.

## Hard rules

- **The key is never printed, echoed, logged, written to a file, pasted into a message or shown in a screenshot.** Read it only as `process.env.PEER_TEST_GEMINI_API_KEY` inside the Playwright script that fills the Profile form (`page.fill`), and in a hygiene check that greps for its value and prints a **count only**. Never `echo $PEER_TEST_GEMINI_API_KEY`, never `env`, never `printenv` without a filter, never screenshot the Profile / key form. Delete every Playwright storage-state file (they hold the key in localStorage) before you finish.
- **No git writes**: no commit, no push, no branch, no tag; `git status` clean at the end. No production deploy. Never call `mcp__ccd_session__*` tools. Never modify the environment or any Routine.
- The owner's own paper, if one is dropped into this session, is private: never quote more than one sentence of it in a message or a file; never commit it; delete it from the container's disk only if the owner asks.
- If Google answers 429 / RESOURCE_EXHAUSTED / a quota or billing error, stop the walk at once and report it (the owner tops up the key).
- Report faithfully: a step that did not run is reported as not run, never as passed.

## Setup

1. `cd web && npm ci` (Node 22). Playwright is at `/opt/node-tools/node_modules/playwright` (`createRequire("/opt/node-tools/node_modules/")`), Chromium at `/opt/pw-browsers/chromium`; never run `playwright install`.
2. Check the variable is present without printing it: `node -e 'process.exit(process.env.PEER_TEST_GEMINI_API_KEY ? 0 : 1)' && echo present`.
3. The test paper: `curl -sSL -o /tmp/peer-key/dynamo.pdf https://raw.githubusercontent.com/papers-we-love/papers-we-love/master/datastores/dynamo-amazons-highly-available-key-value-store.pdf` (a public, two-column, 16-page paper; `raw.githubusercontent.com` is reachable from this environment, arxiv.org is not). A PDF the owner drops into this session is a second paper for the same walk.
4. The dev server **without any model stub** (the real Gemini host is reachable: `generativelanguage.googleapis.com`; the home feed's upstreams are blocked by the environment, so the home page says it couldn't reach today's sources — expected, not a fault): from `web`, `npx next dev -p 3907 > /tmp/peer-key/dev.log 2>&1 &`, wait for "Ready".
5. The Tier-0 render first: `PORT=3907 PEER_TEST_PDF=/tmp/peer-key/dynamo.pdf OUT_DIR=/tmp/peer-key/r0 node ../docs/reading-helper-abc/harness/render-digestion.mjs` — it uploads the PDF through the real UI without a key and dumps the digestion (read its notes; it is your model for the keyed walk: the upload square, the consent dialog, the paper URL, the tabs).

## The keyed walk (write it as one Playwright script, `/tmp/peer-key/key-walk.mjs`, modelled on the render worker; 1440×1000, light; aborts every non-local request except `generativelanguage.googleapis.com` is unnecessary — the server, not the browser, calls Google)

| Id | What | PASS when |
|---|---|---|
| K1 | Profile → Edit: provider **Gemini**, the key filled from the environment, "Deep report" switched on, saved | The profile shows Gemini and a masked key; no network call carried the key from the browser to anything but `localhost` (route every non-local request to abort and count them: 0 with a key in the URL or headers) |
| K2 | Upload the PDF with the key: the deep report runs | The Summary tab's bands (THE CLAIM, ABSTRACT, WHAT IT PROPOSES, HOW IT WAS DONE, WHAT THEY FOUND, WHERE IT IS THIN — read the exact labels from `web/src/components/reader/copy.ts`) fill with model text within 3 minutes; no error banner; the Decision sentence names the full read; record the wall time and the Gemini model id the server used (`dev.log` names it, or `web/src/lib/llm/providers/gemini.ts`) |
| K3 | Two questions in the question box (e.g. "How does Dynamo handle a node failure?" and "What consistency does a read return?"), settled with Enter on the empty last line | "For your questions" shows a verdict per question (Answered / Partly answered / not addressed), one or more evidence quotes that are verbatim sentences of the paper (check 2 against the digestion text), "Read next" links that resolve to sections |
| K4 | Select a 1–2 sentence passage in a body paragraph → "Explain this?" → the explanation; then a reply in the thread; `e` with a new selection; Escape | A model explanation appears in the always-on window within 60 s; the reply gets an answer; `e` explains the new passage in the same window; Escape clears to the empty state and never hides the window |
| K5 | "Say it plainly" on a read-tier paragraph, each of High school / Undergrad / Graduate | A rewrite appears beside the original; the three levels differ; `u` removes the rewrite |
| K6 | The map's gist lines and the figure binding | Gists present on the rows (model text, one line each); figures: caption-only is expected here (PyMuPDF is absent in the container) — report, not a fault |
| K7 | `c` (copy): the Markdown with the report | The clipboard text holds the report blocks and the questions' answers; no key, no YAML, no fences |
| K8 | Quota / errors | Any 429, RESOURCE_EXHAUSTED, PERMISSION_DENIED, 404 model-not-found from Google is reported at once with the step it struck |
| K9 | Hygiene | `dev.log`, every file under `/tmp/peer-key`, and the Playwright console log contain the key's value 0 times (a Node one-liner that reads the env var and counts matches, printing the count only); storage states deleted; `git status` clean |

Then **read the deep report as a PhD student** of distributed systems: is THE CLAIM the paper's claim; are the numbers right (check three against the paper); is WHERE IT IS THIN fair; do the answers to K3 cite the right passages; is the explanation of K4 correct and at the right level. Score the keyed experience 0–100 with the reasons, the way `docs/reading-helper-abc/P9-RUBRIC.md` scores Theme 2.

## Report

One `send_message` to the manager session with: the K table (PASS / FAIL / not run, one line of evidence each), the model id, the wall times (upload-to-report, explain, plain), the number of Google calls (from `dev.log`, counts only), the PhD read with the score, the quota state, anything broken (the exact error text with the key, if ever present, redacted — it never should be). Keep the owner's or any paper's text to one sentence per finding. Keep the full detail in this session's transcript (screenshots of the page under `/tmp/peer-key/shots` — never of the Profile form). If the usage limit refuses a command, stop cleanly and send what you have.
