"use client";

// The upload button — S7: bring your own PDF, immediately left of the search
// box (see app/page.tsx, the same flex row as SearchBox). A black square the
// height of the search box, a white upload glyph, no icon library (this repo
// hand-writes every icon it uses). Click opens the native file picker;
// dropping a PDF onto the square works the same way.
//
// The square's colors are fixed regardless of light/dark mode
// (--color-fixed-black/--color-fixed-white in globals.css) — this one control
// is deliberately not theme-adaptive, per the literal spec ("a black square
// with an upload icon in white").

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import { UPLOAD_BUTTON } from "@/lib/briefing/copy";

interface UploadResponse {
  id: string;
  paper: Paper;
}

// 5-03: mirrors MAX_UPLOAD_BYTES in api/papers/upload/route.ts — a plain
// number, not an import, since a Route Handler module's exports are
// constrained to what Next allows (route.ts cannot export a plain
// constant for a client component to share). Same wording as the server's
// own message so a client-side and server-side rejection read identically.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Exported for the test — a quick client-side check so an obviously
 * wrong file (an image, a video) never makes a round trip; the server's own
 * magic-byte check is still the actual source of truth. */
export function looksLikePdf(file: Pick<File, "type" | "name">): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** 5-03: exported for the test, same reasoning as `looksLikePdf` — this repo
 * has no component-rendering test harness, so the decision a handler makes
 * is what gets unit-tested directly, not the JSX around it. */
export function isOverUploadCap(file: Pick<File, "size">): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // fall through to the generic message below
  }
  return `Upload failed (${res.status}).`;
}

export function UploadButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!looksLikePdf(file)) {
      setError(UPLOAD_BUTTON.error("That doesn't look like a PDF."));
      return;
    }
    // 5-03: refuse an over-cap file before the request — saves a round
    // trip for an obviously-too-big file. Not a substitute for the
    // server's own check (5-02): a non-browser client or a request built
    // by hand still needs the server to enforce this.
    if (isOverUploadCap(file)) {
      setError(UPLOAD_BUTTON.error("That PDF is larger than 25 MB."));
      return;
    }
    setIsUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      // Not `apiFetch`: it sets `Content-Type: application/json` on any
      // request with a body that doesn't already carry one, which would
      // corrupt a multipart request — the browser must set its own
      // `Content-Type` (with the boundary) for a `FormData` body.
      const res = await fetch("/api/papers/upload", { method: "POST", body: form });
      if (!res.ok) {
        setError(UPLOAD_BUTTON.error(await errorFromResponse(res)));
        return;
      }
      const data = (await res.json()) as UploadResponse;
      router.push(`/papers/${encodeURIComponent(data.id)}`);
      // Deliberately not resetting `isUploading` on the success path: the
      // button should stay disabled through the navigation, not flash back
      // to its normal state for the instant before the route changes.
    } catch {
      setError(UPLOAD_BUTTON.error("Upload failed — check your connection and try again."));
      setIsUploading(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        aria-label={UPLOAD_BUTTON.label}
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isUploading) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          if (isUploading) return;
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className={`group inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md bg-[color:var(--color-fixed-black)] transition-[opacity,transform] duration-150 ease-snap active:scale-90 disabled:opacity-50 disabled:cursor-wait ${
          isDragOver ? "opacity-75" : ""
        }`}
      >
        {/* The glyph, not the square, grows on hover — a quick, small swell
            (~120 ms) that reads as "this reacts", the way the reader's other
            controls do; a drop hover gets the same cue. */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`text-[color:var(--color-fixed-white)] transition-transform duration-[120ms] ease-snap group-hover:scale-125 group-disabled:scale-100 ${
            isDragOver ? "scale-125" : ""
          }`}
        >
          <path d="M12 16V4" />
          <path d="M6 10l6-6 6 6" />
          <path d="M4 20h16" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still fires onChange.
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      {error && (
        <p
          role="alert"
          className="absolute left-0 top-full z-10 mt-1.5 w-max max-w-[240px] font-mono text-caption text-red"
        >
          {error}
        </p>
      )}
    </div>
  );
}
