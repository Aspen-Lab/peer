import type { Metadata } from "next";
import {
  Host_Grotesk,
  Inter,
  Newsreader,
  Noto_Sans_SC,
  Roboto_Mono,
} from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import { Masthead } from "@/components/shell/masthead";
import { ThumbBar } from "@/components/shell/thumb-bar";
import { UndoToast } from "@/components/undo-toast";
import { KeyboardLayer } from "@/components/keyboard";
import { ProfileSync } from "@/components/profile-sync";
import { FeedSync } from "@/components/feed-sync";
import { ThemeSync } from "@/components/theme-sync";
import { TabIconSync } from "@/components/tab-icon-sync";
import { FirstRunGate } from "@/components/first-run";
import { StoreHydrator } from "@/components/store-hydrator";

// Primary UI sans — Delphi-style interface text
// Peer's own voice: the dateline, the page titles, every label and control.
// Host Grotesk is the open face Latent name as their own fallback, and the
// reason to take it rather than Inter is the shape of a display line at
// weight 400 with -0.03em tracking — Inter goes soft there and needs weight
// to hold, which is the look this moves away from.
const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Mono — for kbd, tabular metadata, technical strings
const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-roboto-mono",
  display: "swap",
});

// Serif — display headlines AND long prose. Variable font with an optical
// size axis, closest open face to Delphi's Martina Plantijn; light (300)
// at display sizes, 400 for reading.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  style: ["normal", "italic"],
  display: "swap",
});

// CJK fallback
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sc",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  // Every link to Peer renders somewhere before it renders here: a chat, a
  // post, a message. Until launch that arrived as a bare URL.
  metadataBase: new URL(SITE_URL),
  title: "Peer",
  description: "Today's papers, chosen for your work.",
  openGraph: {
    type: "website",
    siteName: "Peer",
    title: "Peer",
    description: "Ten papers a day, chosen for your work. No feed, no backlog.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Peer",
    description: "Ten papers a day, chosen for your work. No feed, no backlog.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      data-mode="system"
      data-accent="ember"
      // The boot script below rewrites data-mode/data-accent before
      // hydration; suppress the expected server/client attribute mismatch.
      suppressHydrationWarning
      className={`${hostGrotesk.variable} ${inter.variable} ${robotoMono.variable} ${newsreader.variable} ${notoSansSC.variable} h-full`}
    >
      <body className="min-h-full flex flex-col antialiased">
        {/* Pre-paint theme boot: apply the persisted mode+accent before first
            paint so dark palettes never flash ivory. Reads the zustand-persist
            snapshot (store/profile.ts, name: "peer-profile"); legacy
            single-name themes map like lib/theme.ts LEGACY. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var L={system:"system:ember",cream:"light:ember",white:"light:indigo",pink:"light:rose",blue:"light:indigo",sage:"light:sage",lavender:"light:violet",black:"dark:ember",slate:"dark:indigo",plum:"dark:violet"};var t=JSON.parse(localStorage.getItem("peer-profile")).state.profile.colorTheme;t=L[t]||t;var p=String(t).split(":");if(["system","light","dark"].indexOf(p[0])>=0&&["ember","rose","marigold","sage","indigo","violet"].indexOf(p[1])>=0){var r=document.documentElement;r.setAttribute("data-mode",p[0]);r.setAttribute("data-accent",p[1])}}catch(e){}})()`,
          }}
        />
        {/* The shell: one masthead above the page on desktop, one thumb bar
            under it on a phone; both are client components that return null
            on /welcome. <main> carries no padding for either — the masthead
            is in flow and sticky, the thumb bar leaves its own spacer. */}
        <Masthead />
        <main className="flex-1 peer-main-content">{children}</main>
        <ThumbBar />
        <UndoToast />
        <KeyboardLayer />
        <StoreHydrator />
        <ThemeSync />
        {/* TAB-ICON-THEME round 2 (ABC-JEV-INTEGRATION.md §1ak). Hand-authored
            here, outside Next's file-based `icon.svg` metadata: that system
            re-renders its <link> from a Server Component keyed by a fresh
            per-request id on every client-side navigation
            (generateDynamicRSCPayload -> getFlightMetadataKey), so React
            mounts a brand-new, un-themed <link> instead of reusing the one
            tab-icon.ts paints, and the two are never deduped (a rel="icon"
            <link> is a plain Hoistable in React 19, not a deduped Resource
            the way rel="stylesheet"+precedence is - confirmed by reading
            react-dom's isHostHoistableType). This tag lives in the root
            layout's own returned JSX instead, which this exact app only ever
            renders once per tab (never re-keyed or remounted by navigation),
            so there is nothing left to compete with it. React still hoists
            it into <head> wherever it is written in this tree, same
            Hoistable mechanism, just with only one instance in existence.
            web/public/icon.svg (moved out of app/ so Next no longer treats
            it as metadata) is the plain static resource this points at and
            the no-JS / first-paint fallback; tab-icon.ts repaints THIS
            element in place, by id, and never creates a second one. */}
        <link
          rel="icon"
          id="peer-tab-icon"
          href="/icon.svg"
          type="image/svg+xml"
        />
        <TabIconSync />
        <ProfileSync />
        <FeedSync />
        <FirstRunGate />
              {/* Page counts only — how many people arrived and where they
            landed. It records the page, never who was on it. */}
        <Analytics />
</body>
    </html>
  );
}
