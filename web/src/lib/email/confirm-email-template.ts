// EMAIL-SETTINGS — the "confirm this address" email content. A new sibling
// file to digest-template.ts (that file is intentionally NOT edited — see
// guide docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md §2.5), so the
// small esc() escaper and brand palette below are deliberate, tiny
// duplicates rather than an import from that file.
//
// Sent via the existing, unmodified sendDigestEmail({ items: [], render:
// {...} }) call shape — the same "empty items + render override" trick
// digest-retry.ts's handleConflictingEmailClaim already uses, so
// send-digest.ts needs no change at all.

// Brand palette — mirrors digest-template.ts (kept in sync by eye; both are
// small and rarely change).
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

export interface ConfirmEmailTemplateInput {
  confirmUrl: string;
}

export function renderConfirmEmailSubject(): string {
  return "Confirm this email for your Peer briefing";
}

export function renderConfirmEmailPlaintext(input: ConfirmEmailTemplateInput): string {
  const { confirmUrl } = input;
  return [
    "CONFIRM YOUR EMAIL — PEER",
    "",
    "Someone (hopefully you) asked for Peer's daily paper briefing to be",
    "sent to this address. Click the link below to confirm it:",
    "",
    confirmUrl,
    "",
    "This link works for 24 hours. If you didn't request this, you can",
    "safely ignore this email — nothing will be sent here unless the link",
    "is opened.",
  ].join("\n");
}

export function renderConfirmEmailHtml(input: ConfirmEmailTemplateInput): string {
  const { confirmUrl } = input;
  const href = esc(confirmUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirm your email — Peer</title>
</head>
<body style="margin: 0; padding: 0; background: ${BRAND.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${BRAND.bg};">
  <tr>
    <td align="center" style="padding: 40px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; width: 100%; background: ${BRAND.surface}; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <tr>
          <td style="padding: 32px 28px;">
            <div style="font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: ${BRAND.accent}; text-transform: uppercase; margin-bottom: 14px;">
              PEER
            </div>
            <div style="font-family: Georgia, 'Instrument Serif', serif; font-size: 22px; line-height: 1.3; color: ${BRAND.ink}; font-weight: 600; margin-bottom: 14px;">
              Confirm this email for your daily briefing
            </div>
            <div style="font-family: -apple-system, sans-serif; font-size: 14px; line-height: 1.6; color: ${BRAND.muted}; margin-bottom: 22px;">
              Someone (hopefully you) asked for Peer's daily paper briefing to be sent to this address. Click below to confirm it.
            </div>
            <div style="margin-bottom: 22px;">
              <a href="${href}" style="display: inline-block; padding: 12px 22px; background: ${BRAND.accent}; color: #FFFFFF; text-decoration: none; border-radius: 999px; font-family: -apple-system, sans-serif; font-size: 14px; font-weight: 600;">
                Confirm email
              </a>
            </div>
            <div style="font-family: -apple-system, sans-serif; font-size: 12px; line-height: 1.6; color: ${BRAND.faint};">
              This link works for 24 hours. If you didn't request this, you can safely ignore this email — nothing will be sent here unless the link is opened.
            </div>
            <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid ${BRAND.border}; font-family: -apple-system, sans-serif; font-size: 11px; color: ${BRAND.faint}; word-break: break-all;">
              Or paste this link into your browser: ${href}
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
