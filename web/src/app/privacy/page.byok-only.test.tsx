import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

/**
 * /privacy is "written from the code": every claim points at a table, a fetch or
 * a line. It changes in the same commit as the behaviour it describes, so these
 * cases pin the model-key claims to what the code does now.
 */

function text(): string {
  return renderToStaticMarkup(<PrivacyPage />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

describe("/privacy after Peer stopped having a model of its own", () => {
  it("says Peer has no model of its own and that a model runs only on the reader's key", () => {
    expect(text()).toContain("Peer has no model of its own.");
    expect(text()).toContain("run only if you add your own provider key");
  });

  it("describes the path the key takes: browser, Peer's server, the chosen provider, not stored", () => {
    const page = text();
    expect(page).toContain("sends the request to Peer's server with your key attached");
    expect(page).toContain("passes it to the provider you chose");
    expect(page).toContain("is not stored");
    // Still true, and still the one line that keeps the key out of the sync.
    expect(page).toContain("void feedAiApiKey");
  });

  it("no longer claims a request goes to Google from Peer's own model", () => {
    const page = text();
    expect(page).not.toContain("When Peer's own model is used instead");
    expect(page).not.toContain("Google's Gemini API from Peer's server");
    expect(page).not.toContain("Google (Gemini) sees");
  });

  it("names the provider whose key you added, not a fixed company", () => {
    expect(text()).toContain("The model provider whose key you added sees");
  });

  it("no longer says Peer pays for calls", () => {
    expect(text()).not.toContain("Every call Peer pays for");
    expect(text()).toContain("Every model call writes one row");
    expect(text()).toContain("the row carries no account id");
  });

  it("carries the date of this change", () => {
    expect(text()).toContain("Last changed 2026-10-06");
  });
});
