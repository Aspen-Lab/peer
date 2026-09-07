import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-24 font-sans">
      <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-faint">
        404
      </p>
      <h1 className="mt-3 text-display-xs font-semibold tracking-[-0.01em] text-heading">
        Page not found.
      </h1>
      <p className="mt-2 text-body leading-[1.6] text-text-muted">
        The link may be stale, or this item is no longer in your feed.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex h-10 items-center rounded-full bg-accent px-5 text-body font-medium text-bg transition-opacity hover:opacity-90"
      >
        ← Back to feed
      </Link>
    </div>
  );
}
