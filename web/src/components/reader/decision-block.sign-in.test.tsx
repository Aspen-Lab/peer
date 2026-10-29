import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ADD_KEY_HREF, SIGN_IN_HREF, paperReturnPath } from "@/lib/navigation/add-key-destination";
import { DecisionBlock } from "./decision-block";
import { BUTTON } from "./copy";

// The link after the Decision block's sentence. With no key it is "Add a key",
// to the key step. A reader with a key saved who is signed out is not missing a
// key — Peer uses it only for a signed-in reader — so for them (`keyNeedsSignIn`)
// the link reads "Sign in" and goes to the Profile, whose first block is the
// Account section with the sign-in buttons, asking to come back to the paper.

function details(props: { showAddKey: boolean; keyNeedsSignIn?: boolean; signInReturnTo?: string }): string {
  return renderToStaticMarkup(
    createElement(DecisionBlock, {
      part: "details",
      sentences: ["SENTENCE-MARK."],
      ...props,
    }),
  );
}

/** Every link in the markup, as its href and its text. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]*>/g, "").trim(),
  }));
}

describe("DecisionBlock - the link after the sentence", () => {
  it("the words and the destination", () => {
    expect(BUTTON.signIn).toBe("Sign in");
    expect(BUTTON.addKey).toBe("Add a key");
    expect(SIGN_IN_HREF).toBe("/profile");
  });

  it("no key: 'Add a key', to the key step, as before", () => {
    expect(links(details({ showAddKey: true }))).toEqual([{ href: ADD_KEY_HREF, text: "Add a key" }]);
    expect(links(details({ showAddKey: true, keyNeedsSignIn: false }))).toEqual([{ href: ADD_KEY_HREF, text: "Add a key" }]);
  });

  it("a key saved, signed out: 'Sign in', to the Profile, and no 'Add a key'", () => {
    const html = details({ showAddKey: true, keyNeedsSignIn: true });
    expect(links(html)).toEqual([{ href: SIGN_IN_HREF, text: "Sign in" }]);
    expect(html).not.toContain("Add a key");
    expect(html).not.toContain(ADD_KEY_HREF);
  });

  it("comes back to the paper: '/profile?return=' and the paper's own path, encoded as one query value", () => {
    const back = paperReturnPath("openalex:W7204479535");
    expect(back).toBe("/papers/openalex%3AW7204479535");
    const html = details({ showAddKey: true, keyNeedsSignIn: true, signInReturnTo: back });
    expect(links(html)).toEqual([{ href: "/profile?return=%2Fpapers%2Fopenalex%253AW7204479535", text: "Sign in" }]);
    // What the Profile reads back from its query is the paper's path, exactly.
    const href = links(html)[0].href;
    expect(new URL(href, "https://peer.homes").searchParams.get("return")).toBe(back);
    expect(new URL(href, "https://peer.homes").pathname).toBe(SIGN_IN_HREF);
  });

  it("the return path changes nothing for a reader with no key: still 'Add a key', to the key step", () => {
    const html = details({ showAddKey: true, signInReturnTo: paperReturnPath("openalex:W1") });
    expect(links(html)).toEqual([{ href: ADD_KEY_HREF, text: "Add a key" }]);
  });

  it("stands after the sentence, in the same paragraph", () => {
    const html = details({ showAddKey: true, keyNeedsSignIn: true });
    const para = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    expect(para).not.toBeNull();
    expect(para![1].indexOf("SENTENCE-MARK.")).toBeLessThan(para![1].indexOf("Sign in"));
  });

  it("no link at all when the page shows none, whatever the sign-in state", () => {
    expect(links(details({ showAddKey: false }))).toEqual([]);
    expect(links(details({ showAddKey: false, keyNeedsSignIn: true }))).toEqual([]);
  });
});
