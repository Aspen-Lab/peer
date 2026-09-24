// POST /api/feedback — append a feedback event
//
// Append-only signal stream. Future Tier 1/2 re-ranking reads from here.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ItemKind = "paper" | "event" | "job";
type Feedback = "liked" | "saved" | "notInterested" | "moreLikeThis";

// P2-S4b (Round 3) — F-A-P2-04 (4c), ABC-JEV-INTEGRATION.md §1p.B(5),
// docs/jev-abc/P2-B-20260924T0345Z.md F-A-P2-04 point 3 (4c(i)). ADDITIVE
// ONLY: derives a small, typed `resolvedIds` object from `itemId` — which
// is already `"source:nativeId"`, the same id form every RawItem carries —
// and merges it into the stored `payload` for a paper feedback event.
// `preferences/positive-seeds.ts`'s resolver reads this at read time so it
// doesn't have to re-parse `item_id` text itself.
//
// Never touches auth/validation: `user_id` always comes from the
// authenticated session (below, unchanged), never from anything in the
// request body — `itemId` is used only to derive a same-provider id
// string, never trusted for authorization.
//
// Byte-identical to today whenever nothing is derivable: a non-"paper"
// item kind, or an itemId whose source isn't one of these four recognized
// forms (e.g. "dblp"/"web"/"hn"), leaves `payload` exactly as the client
// sent it.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvedIdsFromItemId(itemId: string): Record<string, string> | undefined {
  const idx = itemId.indexOf(":");
  if (idx < 0) return undefined;
  const source = itemId.slice(0, idx);
  const nativeId = itemId.slice(idx + 1).trim();
  if (!nativeId) return undefined;
  switch (source) {
    case "openalex":
      return { openalexId: nativeId };
    case "semantic_scholar":
      return { s2Id: nativeId };
    case "arxiv":
      return { arxivId: nativeId };
    case "pubmed":
      return { pmid: nativeId };
    default:
      return undefined;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await request.json()) as {
    itemId?: string;
    itemKind?: ItemKind;
    feedback?: Feedback;
    payload?: unknown;
  };
  if (!body.itemId || !body.itemKind || !body.feedback) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // P2-S4b — additive only (see the function's own doc comment above).
  const resolvedIds = body.itemKind === "paper" ? resolvedIdsFromItemId(body.itemId) : undefined;
  const payload = resolvedIds
    ? { ...(isRecord(body.payload) ? body.payload : {}), resolvedIds }
    : (body.payload ?? null);

  let { error } = await supabase.from("feedback_events").insert({
    user_id: user.id,
    item_id: body.itemId,
    item_kind: body.itemKind,
    feedback: body.feedback,
    payload,
  });

  if (error && /payload/.test(error.message)) {
    ({ error } = await supabase.from("feedback_events").insert({
      user_id: user.id,
      item_id: body.itemId,
      item_kind: body.itemKind,
      feedback: body.feedback,
    }));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
