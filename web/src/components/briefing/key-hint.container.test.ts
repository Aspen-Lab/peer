// P7-16 (R12): `KeyHint`, the container, with the browser's side of it present.
//
// `key-hint.test.tsx` renders on the server, where the container has to render
// nothing. Here it runs on `test-support/hook-runtime` with a stand-in for the
// profile store and for `window.localStorage`, and the element it returns is
// read directly: nothing (a key exists, or the row was dismissed) or the row,
// whose dismiss handler is called the way a tap would.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return {
    ...actual,
    ...hookRuntime.hooks,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

const world = vi.hoisted(() => ({
  profile: { feedAiProvider: "default", feedAiApiKey: "" } as Record<string, unknown>,
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: (selector: (s: { profile: Record<string, unknown> }) => unknown) =>
    selector({ profile: world.profile }),
}));

import { hookRuntime } from "@/test-support/hook-runtime";
import { KEY_HINT_EVENT, KEY_HINT_STORAGE_KEY, resetKeyHintMemory } from "@/lib/briefing/key-hint";
import { KeyHint, KeyHintRow } from "./key-hint";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
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

async function render() {
  const mounted = await hookRuntime.mount(() => KeyHint());
  mounted.unmount();
  return mounted.value as { type: unknown; props: { onDismiss: () => void } } | null;
}

describe("KeyHint — shown, hidden and dismissed (P7-16, R12)", () => {
  const storage = memoryStorage();
  const fired: string[] = [];

  beforeEach(() => {
    storage.clear();
    fired.length = 0;
    resetKeyHintMemory();
    world.profile = { feedAiProvider: "default", feedAiApiKey: "" };
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: (event: Event) => {
        fired.push(event.type);
        return true;
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the row for a reader with no key who has not dismissed it", async () => {
    const row = await render();
    expect(row).not.toBeNull();
    expect(row!.type).toBe(KeyHintRow);
  });

  it("shows nothing once a key exists", async () => {
    world.profile = { feedAiProvider: "openai", feedAiApiKey: "an-invented-key-for-the-test" };
    expect(await render()).toBeNull();
  });

  it("still shows the row when a provider is chosen and no key is typed yet", async () => {
    world.profile = { feedAiProvider: "openai", feedAiApiKey: "" };
    expect(await render()).not.toBeNull();
  });

  it("dismissing writes the flag and tells the page, and the row stays away on the next open", async () => {
    const row = await render();
    row!.props.onDismiss();
    expect(storage.getItem(KEY_HINT_STORAGE_KEY)).toBe("1");
    expect(fired).toEqual([KEY_HINT_EVENT]);

    resetKeyHintMemory();
    expect(await render()).toBeNull();
  });

  it("shows nothing when the browser says it was dismissed before", async () => {
    storage.setItem(KEY_HINT_STORAGE_KEY, "1");
    expect(await render()).toBeNull();
  });
});
