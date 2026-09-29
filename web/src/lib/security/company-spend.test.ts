import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { requireCompanySpendCapability } from "./company-spend";

const envKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;
const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

afterEach(() => {
  for (const key of envKeys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("company spend capability", () => {
  it("returns 401 no-store for an unauthenticated configured deployment", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });

    const result = await requireCompanySpendCapability();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect((result as Response).headers.get("Cache-Control")).toBe("no-store");
  });

  it("remains fail-closed with 503 even for an authenticated user until durable reservation exists", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-a" } } }) } });

    const result = await requireCompanySpendCapability();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
    expect((result as Response).headers.get("Cache-Control")).toBe("no-store");
  });
});
