import Link from "next/link";
import { PageContainer } from "@/components/ui/page-container";

export default function AuthErrorPage() {
  return (
    <PageContainer>
      <p className="eyebrow text-text-faint mb-3">Sign-in hiccup</p>
      <h1
        className="display-line text-display-sm lg:text-display text-heading leading-[1.1]"
      >
        That didn&rsquo;t go through.
      </h1>
      <p className="mt-3 text-text-muted leading-relaxed">
        The sign-in handshake failed. Usually a stale link or a redirect URL
        that isn&rsquo;t whitelisted in Supabase. Try again in a moment.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 mt-6 text-body-sm text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/70 underline-offset-4 transition-all ease-out active:scale-[0.97]"
      >
        Back to Peer
        <span className="text-caption opacity-70">→</span>
      </Link>
    </PageContainer>
  );
}
