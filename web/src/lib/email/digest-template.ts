// Digest email template. Server-only — emits HTML + plaintext for Resend.
//
// Kept table-based, inline-styled, 600px max width. Email clients (Gmail
// especially) strip <style> and modern CSS; tables + inline styles are
// the boring path that renders everywhere.

import type { ScoredItem } from "@/lib/scoring/types";
import { FEED_EMPTY_REASON_CODES, type FeedEmptyReasonCode } from "@/lib/feed/types";
import { DIGEST_EMPTY, type DigestEmptyEntry } from "@/lib/briefing/copy";

// Brand palette — mirrors the web app.
const BRAND = {
  bg: "#F5EDD7",
  surface: "#FFFFFF",
  ink: "#1C1A16",
  muted: "#6B6358",
  faint: "#9A9286",
  accent: "#F58414",
  border: "#E3D9BF",
};

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string | undefined | null, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function itemHref(id: string, originUrl: string): string {
  // Each source has a prefixed id like `arxiv:2401.12345`. The briefing
  // detail page handles decoding.
  return `${originUrl}/papers/${encodeURIComponent(id)}`;
}

export interface DigestTemplateInput {
  firstName?: string;
  items: ScoredItem[];
  originUrl: string; // e.g. https://hermes-flax-six.vercel.app
  /**
   * EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj) — forwarded verbatim
   * from `FeedMeta.emptyReasonCode` (feed/pipeline.ts's
   * `computeEmptyReasonCode`) by every caller. Only ever consulted when
   * `items.length === 0`; ignored otherwise (§4 test 4 below pins this).
   * Structurally optional/absent, exactly like the field it's forwarded
   * from — never invented when the pipeline didn't resolve one.
   */
  emptyReasonCode?: FeedEmptyReasonCode;
}

/**
 * EMPTY-EMAIL-REASON — one source of truth for "does this empty-case code
 * have ruled copy", read by BOTH `renderDigestHtml` and
 * `renderDigestPlaintext` below so the two can never independently drift.
 * Checked against `FEED_EMPTY_REASON_CODES` membership (never bare
 * truthiness) — the same discipline `feed/empty-reason.ts` already applies
 * on the client — so a missing OR an unrecognized code (an older caller, or
 * a future server value this build doesn't know yet) both fall through to
 * `null`, meaning "use today's generic sentence", never a guess.
 */
function resolvedEmptyEntry(code: FeedEmptyReasonCode | undefined): DigestEmptyEntry | null {
  return code && FEED_EMPTY_REASON_CODES.includes(code) ? DIGEST_EMPTY[code] : null;
}

export function renderDigestSubject(items: ScoredItem[]): string {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (items.length === 0) return `Your Peer briefing · ${dateStr}`;
  const lead = truncate(items[0].title, 50);
  return `${lead} · Peer briefing ${dateStr}`;
}

/**
 * EMPTY-EMAIL-REASON — the plaintext counterpart of `renderDigestHtml`'s
 * generic empty-state row (below), so the fallback sentence exists in BOTH
 * parts, not just HTML (§1.6 of the B guide: before this item, plaintext had
 * no empty-case explanation at all — just "Here are 0 items..." and
 * silence). Content matches the HTML generic sentence; the link is a plain
 * URL in parentheses, not markup — plaintext has no `<a>`.
 */
function genericEmptyPlaintext(originUrl: string): string {
  return `No items matched your topics today. Try adjusting your signals (${originUrl}/profile).`;
}

/**
 * Renders one `DigestEmptyEntry` as plain text: the sentence, then its
 * optional link rendered as `text (url)` — never an HTML anchor.
 *
 * EMPTY-EMAIL-REASON (§1bj.10) — round 2 (§1bj.8) briefly needed this to
 * tolerate an empty `entry.sentence` (a link-only sentence, for the
 * already-delivered case of that round); §1bj.10 reworded that entry back
 * to a plain, link-free sentence, so every `DIGEST_EMPTY` entry has a
 * non-empty `sentence` again and this simple form (always a separator space
 * before a present `link`) is sufficient — simplified back from round 2's
 * generalization, which is no longer reachable through any real entry or
 * covered by any test.
 */
function reasonEmptyPlaintext(entry: DigestEmptyEntry, originUrl: string): string {
  const link = entry.link;
  const linkPart = link ? ` ${link.before}${link.text} (${originUrl}${link.path})${link.after}` : "";
  return `${entry.sentence}${linkPart}`;
}

export function renderDigestPlaintext(input: DigestTemplateInput): string {
  const { firstName, items, originUrl, emptyReasonCode } = input;
  const greet = firstName ? `Hi ${firstName},` : "Hi,";
  const today = formatDate(new Date());
  const lines: string[] = [
    `PEER BRIEFING — ${today}`,
    "",
    greet,
    "",
    `Here are ${items.length} items worth your attention today.`,
    "",
  ];
  if (items.length === 0) {
    const entry = resolvedEmptyEntry(emptyReasonCode);
    lines.push(entry ? reasonEmptyPlaintext(entry, originUrl) : genericEmptyPlaintext(originUrl));
    lines.push("");
  }
  items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.title}`);
    if (item.authors && item.authors.length > 0) {
      lines.push(`   ${item.authors.slice(0, 3).join(", ")}${item.authors.length > 3 ? " et al." : ""}`);
    }
    if (item.venue) lines.push(`   ${item.venue}`);
    if (item.relevanceReason) lines.push(`   Why: ${truncate(item.relevanceReason, 180)}`);
    lines.push(`   ${itemHref(item.id, originUrl)}`);
    lines.push("");
  });
  lines.push("—");
  lines.push(`Read in browser: ${originUrl}`);
  lines.push(`Adjust or turn off this digest: ${originUrl}/profile`);
  return lines.join("\n");
}

function renderItemRow(item: ScoredItem, originUrl: string): string {
  const href = itemHref(item.id, originUrl);
  const authors =
    item.authors && item.authors.length > 0
      ? esc(
          item.authors.slice(0, 3).join(", ") +
            (item.authors.length > 3 ? " et al." : ""),
        )
      : "";
  const venue = esc(item.venue || "");
  const reason = esc(truncate(item.relevanceReason, 200));
  const matchPct =
    typeof item.score === "number" ? Math.round(item.score * 100) : null;

  return `
<tr>
  <td style="padding: 18px 24px; border-bottom: 1px solid ${BRAND.border};">
    <a href="${esc(href)}" style="color: ${BRAND.ink}; text-decoration: none; display: block;">
      <div style="font-family: Georgia, 'Source Serif 4', serif; font-size: 17px; line-height: 1.35; font-weight: 600; color: ${BRAND.ink}; margin-bottom: 6px;">
        ${esc(truncate(item.title, 140))}
      </div>
    </a>
    ${
      authors || venue
        ? `<div style="font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: ${BRAND.muted}; margin-bottom: 8px;">
        ${authors}${authors && venue ? ' <span style="color: ' + BRAND.faint + ';">·</span> ' : ""}<span style="color: ${BRAND.faint};">${venue}</span>
      </div>`
        : ""
    }
    ${
      reason
        ? `<div style="font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; color: ${BRAND.muted};">
        ${reason}
      </div>`
        : ""
    }
    <div style="margin-top: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; color: ${BRAND.faint}; letter-spacing: 0.04em; text-transform: uppercase;">
      <a href="${esc(href)}" style="color: ${BRAND.accent}; text-decoration: none; font-weight: 600;">Read briefing →</a>
      ${matchPct !== null ? `<span style="color: ${BRAND.faint}; margin-left: 12px;">${matchPct}% match</span>` : ""}
    </div>
  </td>
</tr>`;
}

/**
 * Renders one `DigestEmptyEntry` as HTML: the escaped sentence, then its
 * optional link as a real `<a>` — same visual treatment as the generic
 * sentence's own "signals" link below.
 *
 * EMPTY-EMAIL-REASON (§1bj.10) — see `reasonEmptyPlaintext`'s doc comment:
 * simplified back from round 2's (§1bj.8) empty-sentence generalization,
 * which §1bj.10's rewording of `already-delivered` made unreachable through
 * any real `DIGEST_EMPTY` entry and untested.
 */
function reasonEmptyHtml(entry: DigestEmptyEntry, originUrl: string): string {
  const link = entry.link;
  const linkHtml = link
    ? ` ${esc(link.before)}<a href="${originUrl}${link.path}" style="color: ${BRAND.accent};">${esc(link.text)}</a>${esc(link.after)}`
    : "";
  return `${esc(entry.sentence)}${linkHtml}`;
}

export function renderDigestHtml(input: DigestTemplateInput): string {
  const { firstName, items, originUrl, emptyReasonCode } = input;
  const greet = firstName ? `Hi ${esc(firstName)},` : "Hi,";
  const today = formatDate(new Date());

  const rows = items.map((i) => renderItemRow(i, originUrl)).join("");

  // EMPTY-EMAIL-REASON — `reasonEntry` is only ever looked up when there are
  // zero items (an `emptyReasonCode` on a non-empty response is a
  // should-never-happen shape from an upstream caller, and is ignored here
  // exactly like `resolvedEmptyEntry`'s own doc comment says). When it IS
  // empty but no known code resolved, `emptyBody` falls back to the EXACT
  // pre-existing literal sentence, unchanged byte-for-byte — never a guess.
  const reasonEntry = items.length === 0 ? resolvedEmptyEntry(emptyReasonCode) : null;
  const emptyBody = reasonEntry
    ? reasonEmptyHtml(reasonEntry, originUrl)
    : `No items matched your topics today. Try adjusting your <a href="${originUrl}/profile" style="color: ${BRAND.accent};">signals</a>.`;

  const empty =
    items.length === 0
      ? `<tr><td style="padding: 30px 24px; text-align: center; font-family: -apple-system, sans-serif; color: ${BRAND.muted}; font-size: 14px;">${emptyBody}</td></tr>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Peer briefing</title>
</head>
<body style="margin: 0; padding: 0; background: ${BRAND.bg};">
<!-- Preheader (hidden, shown in inbox preview) -->
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
${esc(items[0]?.title ?? "Your daily Peer briefing")} — ${items.length} items picked for you
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${BRAND.bg};">
  <tr>
    <td align="center" style="padding: 40px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background: ${BRAND.surface}; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">

        <!-- Header -->
        <tr>
          <td style="padding: 28px 24px 20px;">
            <div style="font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: ${BRAND.accent}; text-transform: uppercase; margin-bottom: 8px;">
              PEER · ${esc(today.toUpperCase())}
            </div>
            <div style="font-family: Georgia, 'Instrument Serif', serif; font-size: 28px; line-height: 1.15; color: ${BRAND.ink}; font-weight: 600; letter-spacing: -0.01em;">
              ${greet} <span style="font-style: italic; color: ${BRAND.muted};">here's what you missed</span>.
            </div>
            <div style="font-family: -apple-system, sans-serif; font-size: 13px; color: ${BRAND.muted}; margin-top: 10px;">
              ${items.length} items, picked from your sources and ranked against your topics.
            </div>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="border-top: 1px solid ${BRAND.border}; font-size: 0; line-height: 0;">&nbsp;</td></tr>

        <!-- Items -->
        ${rows}
        ${empty}

        <!-- Footer -->
        <tr>
          <td style="padding: 24px; background: ${BRAND.bg};">
            <div style="font-family: -apple-system, sans-serif; font-size: 12px; color: ${BRAND.muted}; line-height: 1.6;">
              <a href="${originUrl}" style="color: ${BRAND.ink}; text-decoration: underline;">Open in browser</a>
              &nbsp;·&nbsp;
              <a href="${originUrl}/profile" style="color: ${BRAND.ink}; text-decoration: underline;">Edit signals or pause digest</a>
            </div>
            <div style="font-family: -apple-system, sans-serif; font-size: 11px; color: ${BRAND.faint}; margin-top: 12px; line-height: 1.5;">
              You're receiving this because you enabled daily digests in Peer. Change preferences or unsubscribe at <a href="${originUrl}/profile" style="color: ${BRAND.faint};">${originUrl}/profile</a>.
            </div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}
