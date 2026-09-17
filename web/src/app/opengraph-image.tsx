// The card every shared link renders — chat, X, Slack, WeChat.
//
// Until launch there was none, so a link to Peer arrived as a bare URL with a
// title and nothing else. This is the briefing's own front, at card size: the
// dateline's face and tracking, the eyebrow, and the day-shape bars that are
// the product's one piece of iconography.
//
// Drawn with the runtime's own sans rather than Host Grotesk on purpose: an
// OG route that fetches a font file at request time fails closed on a cold
// edge, and a missing card is worse than a card in the wrong face.

import { ImageResponse } from "next/og";

export const alt = "Peer — today's papers, chosen for your work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The day's shape, as the briefing draws it. Fixed values: this is a poster. */
const BARS = [52, 52, 40, 39, 38, 38, 38, 34, 31, 28];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#111111",
          color: "#f3f3f3",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 10, height: 10, background: "#ff520d" }} />
          <div
            style={{
              fontSize: 22,
              letterSpacing: "0.16em",
              color: "#a9a9a9",
              textTransform: "uppercase",
            }}
          >
            Daily briefing
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Satori refuses a multi-child div with no `display`, and a text
              node plus a <br> is two children — so each line is its own box. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 84,
              letterSpacing: "-0.03em",
              lineHeight: 1.04,
            }}
          >
            <div style={{ display: "flex" }}>Today&apos;s papers,</div>
            <div style={{ display: "flex" }}>chosen for your work.</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 60 }}>
            {BARS.map((h, i) => (
              <div key={i} style={{ width: 16, height: h, background: "#a9a9a9" }} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24 }}>
          <div style={{ color: "#f3f3f3" }}>Peer</div>
          <div style={{ color: "#838383", letterSpacing: "0.06em" }}>
            Ten papers. No feed.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
