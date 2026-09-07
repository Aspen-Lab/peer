import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <article className="mx-auto max-w-[520px] px-6 py-24 text-center">
      <p
        className="text-caption font-semibold uppercase tracking-[0.22em] text-accent/90 mb-3"
      >
        <span className="inline-block w-5 h-[1.5px] bg-accent/70 align-middle mr-2.5" />
        Sign-in hiccup
      </p>
      <h1
        className="text-display-sm lg:text-display font-semibold text-heading tracking-[-0.02em] leading-[1.1]"
      >
        That didn&rsquo;t go through.
      </h1>
      <p className="mt-3 text-text-muted leading-relaxed">
        The sign-in handshake failed. Usually a stale link or a redirect URL
        that isn&rsquo;t whitelisted in Supabase. Try again in a moment.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 mt-6 text-body-sm text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/70 underline-offset-4 transition-all duration-200 ease-out active:scale-[0.97]"
      >
        Back to Peer
        <span className="text-caption opacity-70">→</span>
      </Link>
    </article>
  );
}
