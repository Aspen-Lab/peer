"use client";

// Root-level crash screen. This replaces the entire root layout, so
// globals.css and next/font are NOT available here — the palette is restated
// inline, and this file is the one place in the product where that is allowed.
//
// It is the last page a reader sees on their worst visit, and it was the last
// cream page in a greyscale product: #fdf6ee on #2a2722, two weight-600
// headings, a 999px pill in #ff520d. The values below are the live greyscale
// (globals.css `:root`), square, at 400.
//
// Deliberately light-only. Peer's dark mode is `html[data-mode="dark"]`, and
// only `data-mode="system"` follows the OS, so a `prefers-color-scheme` block
// here would hand a dark crash screen to a reader who chose light.
const INK = "#1d1d1d";
const BODY = "#282828";
const MUTED = "#666666";
const FAINT = "#8e8e8e";
const GROUND = "#fafafa";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: GROUND,
          color: BODY,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "18vh 24px 0" }}>
          <p
            style={{
              fontSize: 11.5,
              fontWeight: 400,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              color: FAINT,
            }}
          >
            Error
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: 22, fontWeight: 400, color: INK }}>
            Peer hit an unexpected error.
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: MUTED }}>
            Reloading usually clears it. Your profile and saved items are
            stored locally and in your account.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 28,
              height: 40,
              padding: "0 20px",
              borderRadius: 0,
              border: "none",
              // `--shadow-card`'s shape, which is the product's only frame.
              boxShadow: `0 0 0 1px ${INK}`,
              background: "transparent",
              color: INK,
              fontSize: 14,
              fontWeight: 400,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error?.digest ? (
            <p
              style={{
                marginTop: 32,
                fontSize: 12,
                color: FAINT,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            >
              ref {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
