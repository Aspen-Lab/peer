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
