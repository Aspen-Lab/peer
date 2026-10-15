import { beforeEach, describe, expect, it } from "vitest";
import { activePaperTopicsKey } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { STARTER_TOPICS_KEY } from "@/lib/feed/starter-topics";
import { defaultProfile } from "@/types";
import {
  KEY_HINT_STORAGE_KEY,
  readKeyHintDismissed,
  resetKeyHintMemory,
  shouldShowKeyHint,
  writeKeyHintDismissed,
} from "./key-hint";

// P7-16 (R12): after the reader taps a field chip the sample card is gone, and
// with it the only line on the home page that said anything about a key. A
// one-line row stays in its place until the reader adds a key or dismisses it.

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

function brokenStorage(): Storage {
  const fail = () => {
    throw new Error("storage is blocked");
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe("shouldShowKeyHint — the row's rule", () => {
  it("shows with no key and no dismissal", () => {
    expect(shouldShowKeyHint({ hasKey: false, dismissed: false })).toBe(true);
  });

  it("hides once a key exists", () => {
    expect(shouldShowKeyHint({ hasKey: true, dismissed: false })).toBe(false);
  });

  it("hides once dismissed", () => {
    expect(shouldShowKeyHint({ hasKey: false, dismissed: true })).toBe(false);
  });
});

describe("the row after the first field tap", () => {
  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  it("survives the tap that removes the card, and hides when a key is added", () => {
    // Before: the card is on the page (nothing declared) and the row is not needed.
    const before = useProfileStore.getState().profile;
    expect(activePaperTopicsKey(before)).toBe(STARTER_TOPICS_KEY);

    // The tap — what `StarterStrip` does when a field is chosen.
    useProfileStore.getState().updateTopics(["machine learning"]);
    useProfileStore.getState().completeOnboarding();

    // After: the card is gone (the page shows it only for the sample)...
    const after = useProfileStore.getState().profile;
    expect(activePaperTopicsKey(after)).not.toBe(STARTER_TOPICS_KEY);
    // ...and the row is still owed, because no key has been added.
    expect(shouldShowKeyHint({ hasKey: hasUserLlmOverride(after), dismissed: false })).toBe(true);

    // Adding a key (the wizard writes it as it is typed) ends it.
    useProfileStore.getState().updateFeedAiProvider("openai");
    useProfileStore.getState().updateFeedAiApiKey("an-invented-key-for-the-test");
    const keyed = useProfileStore.getState().profile;
    expect(hasUserLlmOverride(keyed)).toBe(true);
    expect(shouldShowKeyHint({ hasKey: hasUserLlmOverride(keyed), dismissed: false })).toBe(false);
  });

  it("a provider chosen with no key typed yet is not a key", () => {
    useProfileStore.getState().updateFeedAiProvider("openai");
    expect(hasUserLlmOverride(useProfileStore.getState().profile)).toBe(false);
  });
});

describe("the dismissal — one flag in this browser", () => {
  beforeEach(() => resetKeyHintMemory());

  it("starts not dismissed", () => {
    expect(readKeyHintDismissed(memoryStorage())).toBe(false);
  });

  it("is remembered once written, and read back by the next page open", () => {
    const storage = memoryStorage();
    writeKeyHintDismissed(storage);
    expect(storage.getItem(KEY_HINT_STORAGE_KEY)).toBe("1");
    resetKeyHintMemory();
    expect(readKeyHintDismissed(storage)).toBe(true);
  });

  it("reads only the value it wrote: anything else is not a dismissal", () => {
    expect(readKeyHintDismissed(memoryStorage({ [KEY_HINT_STORAGE_KEY]: "0" }))).toBe(false);
    expect(readKeyHintDismissed(memoryStorage({ [KEY_HINT_STORAGE_KEY]: "" }))).toBe(false);
  });

  it("does not throw where storage is blocked (a private window), and still holds for the visit", () => {
    const blocked = brokenStorage();
    expect(readKeyHintDismissed(blocked)).toBe(false);
    expect(() => writeKeyHintDismissed(blocked)).not.toThrow();
    expect(readKeyHintDismissed(blocked)).toBe(true);
  });

  it("does not throw with no storage at all (a server render)", () => {
    expect(readKeyHintDismissed(null)).toBe(false);
    expect(() => writeKeyHintDismissed(null)).not.toThrow();
  });
});
