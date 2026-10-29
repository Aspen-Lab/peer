import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P12-66 rule 2 (B P12-52, M3; ruling §1h.437): a key typed while a sticky's editor is started afresh reaches the editor that held the focus.
// The new editor used to take the focus in a passive effect, after the paint: between the old editor's removal and that effect the document had
// no focus, and a key typed then went to the page, where a single letter runs as a command (`keyboard.tsx`: with no typing target focused, `s`,
// `l`, `n`, `h`, `e`, `c` ...). It takes it in a layout effect now. There is no DOM here (and none may be added), so the effect is read as
// source; the page itself was driven by the Playwright run named in the checkpoint (no frame with a sticky open and nothing focused).

const editor = readFileSync(resolve(__dirname, "./note-editor.tsx"), "utf8");

describe("NoteEditor takes an asked-for focus in a layout effect (P12-66, rule 2)", () => {
  const at = editor.indexOf("if (!autoFocus) return;");

  it("the effect that focuses the first block for `autoFocus` is a layout effect, run once on open", () => {
    expect(at).toBeGreaterThan(-1);
    const head = editor.slice(editor.lastIndexOf("useLayoutEffect(", at), at);
    expect(head).toMatch(/^useLayoutEffect\(\(\) => \{\s*$/);
    const body = editor.slice(at, editor.indexOf("}, []);", at));
    expect(body).toContain('focusBlock(first.id, "end")');
  });

  it("no passive effect takes the asked-for focus any more: the passive one is for a note just made, and not for a sticky's editor", () => {
    const passive = editor.slice(editor.indexOf("useEffect(() => {\n    if (autoFocus || transient) return;"));
    expect(passive.startsWith("useEffect(")).toBe(true);
    expect(passive.slice(0, 400)).not.toContain('focusBlock(first.id, "end")');
    // The ones asked for the focus are not asked twice: the passive effect leaves them to the layout effect.
    expect(editor).not.toMatch(/useEffect\(\(\) => \{\s*if \(autoFocus\) \{/);
  });
});
