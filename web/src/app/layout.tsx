import type { Metadata } from "next";
import {
  Inter,
  Newsreader,
  Noto_Sans_SC,
  Roboto_Mono,
} from "next/font/google";
import "./globals.css";
import { Masthead } from "@/components/shell/masthead";
import { ThumbBar } from "@/components/shell/thumb-bar";
import { UndoToast } from "@/components/undo-toast";
import { KeyboardLayer } from "@/components/keyboard";
import { ProfileSync } from "@/components/profile-sync";
import { FeedSync } from "@/components/feed-sync";
import { ThemeSync } from "@/components/theme-sync";
import { FirstRunGate } from "@/components/first-run";
import { StoreHydrator } from "@/components/store-hydrator";

// Primary UI sans — Delphi-style interface text
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
  title: "Peer",
  description: "Today's papers, chosen for your work.",
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
      className={`${inter.variable} ${robotoMono.variable} ${newsreader.variable} ${notoSansSC.variable} h-full`}
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
        <ProfileSync />
        <FeedSync />
        <FirstRunGate />
      </body>
    </html>
  );
}
