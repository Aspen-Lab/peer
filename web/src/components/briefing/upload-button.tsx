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
import { UploadConsentDialog } from "./upload-consent-dialog";
import { UploadMatchConfirmDialog } from "./upload-match-confirm-dialog";
import { UPLOAD_RIGHTS_VERSION } from "@/lib/papers/upload-policy";
import { useProfileStore } from "@/store/profile";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase/client";

interface UploadResponse {
  id: string;
  paper: Paper;
  /** 9-31: only present when this upload bound to a `targetPaper`. */
  attached?: { title: string; band: "doi" | "strong" | "confirm" };
}

/** 9-31 (A9-09): the "confirm" band's own 409 shape — a partial title
 * overlap that needs an explicit yes before it binds. */
interface NeedsConfirmationResponse {
  needsConfirmation: true;
  band: "confirm";
  overlap: number;
  extractedTitle: string;
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

/** `POST /api/papers/upload/ticket`'s answer: send the file in the form, or
 * put it straight into the server's private bucket first. */
type UploadTicket =
  | { mode: "form" }
  | { mode: "direct"; bucket: string; path: string; token: string };

/**
 * Puts the PDF into `form` and returns null, or returns why it could not.
 * Where the server keeps uploads in its Supabase bucket, the browser puts
 * the file there itself and the form only names it — a Vercel function will
 * not take a request body much over 4 MB, and a paper's PDF is often larger.
 * Otherwise the file goes in the form, as it always has.
 */
async function attachPdf(form: FormData, file: File): Promise<string | null> {
  const res = await fetch("/api/papers/upload/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: file.size }),
  });
  if (!res.ok) return errorFromResponse(res);
  const ticket = (await res.json()) as UploadTicket;
  if (ticket.mode !== "direct") {
    form.set("file", file);
    return null;
  }
  if (!supabase) return "Upload failed — this site cannot reach its file storage.";
  // Typed explicitly: some systems give a PDF no MIME type at all, and the
  // bucket takes only PDFs.
  const pdf = new File([file], file.name, { type: "application/pdf" });
  const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, pdf);
  if (error) return "Upload failed — check your connection and try again.";
  form.set("staged", ticket.path);
  form.set("fileName", file.name);
  return null;
}

/** The upload button's words on a paper's own page, where it brings that
 *  paper's full text rather than a new paper. */
const TARGET_UPLOAD = {
  label: "Upload full article PDF",
  busy: "Uploading PDF…",
};

function UploadGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function UploadButton({ className = "", targetPaper, onUploaded }: {
  className?: string; targetPaper?: Paper; onUploaded?: (paper: Paper) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // 9-31 (A9-09): the "confirm" band's own pending state — a partial title
  // overlap that needs an explicit yes before the same file is re-submitted
  // with `confirm=1`.
  const [pendingMatch, setPendingMatch] = useState<{ file: File; extractedTitle: string } | null>(null);
  const recordUpload = useProfileStore((s) => s.recordUploadPreference);

  const chooseFile = (file: File) => {
    setError(null);
    if (!looksLikePdf(file)) { setError("That doesn't look like a PDF."); return; }
    if (isOverUploadCap(file)) { setError("That PDF is larger than 25 MB."); return; }
    setPendingFile(file);
  };

  const upload = async (file: File, confirmMatch = false) => {
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
      const attachError = await attachPdf(form, file);
      if (attachError) {
        setError(UPLOAD_BUTTON.error(attachError));
        return;
      }
      form.set("rightsVersion", UPLOAD_RIGHTS_VERSION);
      if (targetPaper) form.set("targetPaper", JSON.stringify({ id: targetPaper.id, title: targetPaper.title, doi: targetPaper.doi }));
      if (confirmMatch) form.set("confirm", "1");
      // Not `apiFetch`: it sets `Content-Type: application/json` on any
      // request with a body that doesn't already carry one, which would
      // corrupt a multipart request — the browser must set its own
      // `Content-Type` (with the boundary) for a `FormData` body.
      const res = await fetch("/api/papers/upload", { method: "POST", body: form });
      // 9-31: the "confirm" band — neither a success nor a hard failure.
      // Show the dialog and stop; the button returns to normal so the
      // reader can also just cancel and try a different file.
      if (res.status === 409) {
        const body: Partial<NeedsConfirmationResponse> = await res.json().catch(() => ({}));
        if (body.needsConfirmation && typeof body.extractedTitle === "string") {
          setPendingMatch({ file, extractedTitle: body.extractedTitle });
          return;
        }
      }
      if (!res.ok) {
        setError(UPLOAD_BUTTON.error(await errorFromResponse(res)));
        return;
      }
      const data = (await res.json()) as UploadResponse;
      recordUpload(data.paper);
      if (onUploaded) onUploaded(data.paper);
      else router.push(`/papers/${encodeURIComponent(data.id)}`);
      // Deliberately not resetting `isUploading` on the success path: the
      // button should stay disabled through the navigation, not flash back
      // to its normal state for the instant before the route changes.
    } catch {
      setError(UPLOAD_BUTTON.error("Upload failed — check your connection and try again."));
      setIsUploading(false);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={cn("relative", targetPaper && "w-full", className)}>
      <button
        type="button"
        // On a paper's page the words are on the button, and they are its name.
        aria-label={targetPaper ? undefined : UPLOAD_BUTTON.label}
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
          if (file) chooseFile(file);
        }}
        className={targetPaper ? cn(
          // A paper's page: one more row of the decision's command stack
          // (`reader/reader-commands.tsx`) — the same height, edge and mono —
          // drawn dashed, because it is a place to drop a file, not a verdict.
          buttonVariants({ tone: "ghost", size: "lg" }),
          "eyebrow w-full justify-start gap-2 px-3 border border-dashed border-border-strong text-text-muted hover:border-text-faint [@media(hover:none)]:min-h-11",
          isDragOver && "border-accent text-heading",
        ) : `group inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md bg-[color:var(--color-fixed-black)] transition-[opacity,transform] duration-150 ease-snap hover:scale-125 active:scale-90 disabled:scale-100 disabled:opacity-50 disabled:cursor-wait ${
          isDragOver ? "opacity-75 scale-125" : ""
        }`}
      >
        {/* 6-01: the whole square grows on hover now, not just the glyph —
            so the black square and the glyph swell together at one ratio.
            The glyph inherits the parent's transform for free and keeps no
            separate scale of its own. A drop hover gets the same cue.
            (Kept opacity and transform on one shared 150ms transition,
            same as before the swell moved here — Tailwind's separate
            transition-opacity/transition-transform utilities both set the
            single transition-property value, so stacking them as two
            classes would have one silently override the other; this repo's
            own convention is always one combined transition-[a,b] bracket
            for exactly that reason.) */}
        {targetPaper ? (
          <>
            <UploadGlyph size={12} />
            {isUploading ? TARGET_UPLOAD.busy : TARGET_UPLOAD.label}
          </>
        ) : <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-[color:var(--color-fixed-white)]"
        >
          <path d="M12 16V4" />
          <path d="M6 10l6-6 6 6" />
          <path d="M4 20h16" />
        </svg>}
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
          if (file) chooseFile(file);
        }}
      />
      {pendingFile && <UploadConsentDialog file={pendingFile} onCancel={() => setPendingFile(null)}
        onAccept={() => { const file = pendingFile; setPendingFile(null); void upload(file); }} />}
      {pendingMatch && targetPaper && (
        <UploadMatchConfirmDialog
          targetTitle={targetPaper.title}
          extractedTitle={pendingMatch.extractedTitle}
          onCancel={() => setPendingMatch(null)}
          onConfirm={() => { const file = pendingMatch.file; setPendingMatch(null); void upload(file, true); }}
        />
      )}
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
