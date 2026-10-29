import { NextRequest, NextResponse } from "next/server";

import { institutionLogo, normalizedName, type Institution } from "@/lib/affiliation/institution-logo";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!name || name.length > 160 || (id && !/^I\d{1,15}$/.test(id))) {
    return NextResponse.json({ logoUrl: null }, { status: 400 });
  }
  const url = new URL(id ? `https://api.openalex.org/institutions/${id}` : "https://api.openalex.org/institutions");
  url.searchParams.set("select", "id,display_name,image_thumbnail_url,image_url");
  if (!id) {
    url.searchParams.set("search", name);
    url.searchParams.set("per-page", "10");
  }
  try {
    // A keyless request avoids exposing a project API key or its budget through this public endpoint.
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), next: { revalidate: 604800 } });
    if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
    const body = await response.json();
    const records: Institution[] = id ? [body] : Array.isArray(body.results) ? body.results : [];
    const matches = records.filter((record) => record.display_name && normalizedName(record.display_name) === normalizedName(name));
    const logoUrl = matches.length === 1 ? institutionLogo(matches[0], name) : null;
    return NextResponse.json({ logoUrl }, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ logoUrl: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
