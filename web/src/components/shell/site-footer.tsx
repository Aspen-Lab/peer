import Link from "next/link";
import { LICENSE_NAME, LICENSE_URL, REPO_URL } from "@/lib/site";

// One line under every page: who made Peer, the license, the source, the
// privacy notice. It is here for the AGPL: code under that license that is
// used over a network must offer its users the source it runs (section 13),
// so the link has to be on every page and not only on /privacy. A server
// component on purpose — no path check, no hook — so no route can drop it.
// It sits before <ThumbBar /> in the root layout, so the bar's in-flow spacer
// keeps it above the fixed bar on a phone.
const LINK =
  "underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors duration-[180ms] ease-expo";

export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="shrink-0 mx-auto w-full px-6 py-6 text-caption text-text-faint flex flex-wrap justify-center gap-x-3 gap-y-1"
    >
      <span>© 2026 Baichuan Wang and Xiaoyang Wang</span>
      <span aria-hidden>·</span>
      <span>
        Free software under{" "}
        <Link href={LICENSE_URL} className={LINK}>
          {LICENSE_NAME}
        </Link>
      </span>
      <span aria-hidden>·</span>
      <Link href={REPO_URL} className={LINK}>
        Source
      </Link>
      <span aria-hidden>·</span>
      <Link href="/privacy" className={LINK}>
        Privacy
      </Link>
    </footer>
  );
}
