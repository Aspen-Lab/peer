import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ADD_KEY_HREF, SIGN_IN_HREF } from "@/lib/navigation/add-key-destination";
import { DecisionBlock } from "./decision-block";
import { BUTTON } from "./copy";

// The link after the Decision block's sentence. With no key it is "Add a key",
// to the key step. A reader with a key saved who is signed out is not missing a
// key — Peer uses it only for a signed-in reader — so for them (`keyNeedsSignIn`)
// the link reads "Sign in" and goes to the Profile, whose first block is the
// Account section with the sign-in buttons.

function details(props: { showAddKey: boolean; keyNeedsSignIn?: boolean }): string {
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
