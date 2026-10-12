import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthState } from "@/components/account/use-auth-user";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§4b/§1aj) — this repo has no
// @testing-library/react and no test anywhere simulates a click or a file
// picker (see web/src/components/account/account-section.test.tsx's own
// header note on the same convention) — presentational-component tests
// render with renderToStaticMarkup and assert on the output HTML. The
// actual decision logic this control depends on (the P4 merge rules,
// stripping every credential-like field) is proven directly and headlessly
// in web/src/lib/profile/merge.test.ts; this file only proves the control
// renders safely and shows its label regardless of sign-in state.

const mocks = vi.hoisted(() => ({
  authState: { kind: "signed-out" } as AuthState,
}));

vi.mock("@/components/account/use-auth-user", () => ({
  useAuthUser: () => mocks.authState,
}));

import { RestoreFromBackup } from "./restore-backup";

function render(state: AuthState): string {
  mocks.authState = state;
  return renderToStaticMarkup(createElement(RestoreFromBackup));
}

describe("RestoreFromBackup — SSR safety", () => {
  it("renders the control without throwing, signed out", () => {
    expect(() => render({ kind: "signed-out" })).not.toThrow();
  });

  it("renders the control without throwing, signed in", () => {
    expect(() =>
      render({
        kind: "signed-in",
        user: { id: "user-1", email: "person@example.test" } as never,
      }),
    ).not.toThrow();
  });

  it("shows the restore control's label", () => {
    const html = render({ kind: "signed-out" });
    expect(html).toContain("Restore from a backup file");
  });

  it("never renders a file input as anything but a hidden trigger for the button — no raw picker text/content leaks into the visible markup", () => {
    const html = render({ kind: "signed-out" });
    expect(html).toContain('type="file"');
    expect(html).toMatch(/class="[^"]*hidden[^"]*"/);
  });
});

// P9-52 (A P9-W3's N5, §6 item 5): "Restore from a backup file" was 150 x 18 px on a phone (390 x 844, touch). Where
// there is no hover (`hover: none`) the button is at least 44 px tall, the rule P9-23 set for the reading page's
// actions (`[@media(hover:none)]:min-h-11`); with a mouse nothing moves. Layout is not computed in this node
// environment: the box is in the checkpoint (docs/reading-helper-abc/P9-52-C-*.md), and this block pins the classes.
describe("RestoreFromBackup — a touch target where there is no hover (P9-52, N5)", () => {
  const button = () => (render({ kind: "signed-out" }).match(/<button\b[^>]*>/g) ?? [])[0] ?? "";
  const classesOf = (tag: string) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

  it("makes the button at least 44 px tall where there is no hover", () => {
    expect(classesOf(button())).toContain("[@media(hover:none)]:min-h-11");
  });

  it("is the same button, and a mouse's box is the one it was: no height floor outside hover:none", () => {
    const classes = classesOf(button());

    expect(button()).toContain('type="button"');
    expect(classes).toEqual(expect.arrayContaining(["inline-flex", "items-center", "gap-1.5", "text-meta", "text-text-faint"]));
    for (const cls of classes) {
      if (/(^|:)(min-h|h)-/.test(cls)) expect(cls.startsWith("[@media(hover:none)]:"), cls).toBe(true);
    }
  });
});
