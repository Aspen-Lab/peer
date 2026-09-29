import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Opaque, server-only lease for a future durable reservation implementation. */
export interface CompanySpendCapability {
  readonly reservationId: string;
}

const grantedCapabilities = new WeakSet<object>();

export function hasCompanySpendCapability(value: unknown): value is CompanySpendCapability {
  return typeof value === "object" && value !== null && grantedCapabilities.has(value);
}

function hasSupabaseAuthConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

function unavailableResponse() {
  return NextResponse.json(
    { error: "Company-funded search is currently unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Company funding is deliberately disabled until this can create a durable,
 * atomic per-user/global reservation. Credentials and local development are
 * never an implicit grant.
 */
export async function requireCompanySpendCapability(): Promise<
  CompanySpendCapability | NextResponse
> {
  if (!hasSupabaseAuthConfig()) return unavailableResponse();
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in before using company-funded search" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return unavailableResponse();
  }
  // No durable reservation exists yet. Do not substitute an in-memory switch.
  return unavailableResponse();
}
