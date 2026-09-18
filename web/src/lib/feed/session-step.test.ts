import { describe, expect, it } from "vitest";
import { sessionStep } from "./session-step";

describe("sessionStep", () => {
  it("keeps a signed-out reader's own data across a reload", () => {
    // The live bug: this used to run the sign-out reset on every page load
    // for anyone not signed in, so their saves vanished each reload.
    expect(sessionStep({ userId: null, syncedUserId: null })).toBe("keep");
  });

  it("never wipes anything because the session could not be checked", () => {
    // Offline, or a server error, at page load — even with an account's copy
    // here, "could not tell" is not "signed out".
    expect(sessionStep({ userId: undefined, syncedUserId: "a" })).toBe("keep");
    expect(sessionStep({ userId: undefined, syncedUserId: null })).toBe("keep");
  });

  it("clears an account's copy whose session ended while the tab was closed", () => {
    expect(sessionStep({ userId: null, syncedUserId: "a" })).toBe("reset");
  });

  it("clears on a sign-out in this tab", () => {
    expect(sessionStep({ userId: null, syncedUserId: "a", signedOut: true })).toBe("reset");
  });

  it("carries a signed-out reader's data up into the account they sign in to", () => {
    expect(sessionStep({ userId: "a", syncedUserId: null })).toBe("sync");
  });

  it("syncs the same account as before", () => {
    expect(sessionStep({ userId: "a", syncedUserId: "a" })).toBe("sync");
  });

  it("never pushes one account's copy into another account", () => {
    expect(sessionStep({ userId: "b", syncedUserId: "a" })).toBe("reset-then-sync");
  });
});
