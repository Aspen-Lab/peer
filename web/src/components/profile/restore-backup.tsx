"use client";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§4b/§1aj) — "Restore from a
// backup file": a quiet control on the profile page that reads a
// `peer.profile/v1` export (the format `web/src/store/profile.ts`'s
// `exportProfileDocument`/`parseExportedProfile` already define — no screen
// called `importProfile` before this), applies the P4 merge rules (backup
// wins single values, union lists — see lib/profile/merge.ts), and either
// saves the result to the signed-in account (through the ordinary debounced
// sync in profile-sync.tsx — this file never PUTs anything itself) or keeps
// it on this device only when signed out.
//
// Hard rules this file exists to satisfy, restated so they can't drift:
//  - never reads the file anywhere but in the browser (no server round trip);
//  - never displays file contents or any credential value — the one-line
//    result is a plain field COUNT, nothing else;
//  - strips every credential-like field before anything is applied locally
//    (mergeProfileFromBackup does this itself, defense in depth on top of
//    the strip already happening here).

import { useRef, useState } from "react";
import { useAuthUser } from "@/components/account/use-auth-user";
import { useProfileStore } from "@/store/profile";
import { parseExportedProfile } from "@/store/profile";
import { mergeProfileFromBackup } from "@/lib/profile/merge";

export function RestoreFromBackup() {
  const auth = useAuthUser();
  const signedIn = auth.kind === "signed-in";
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setMessage("That file isn't a Peer backup — nothing was changed.");
        return;
      }
      const document = parseExportedProfile(raw);
      if (!document) {
        setMessage("That file isn't a Peer backup — nothing was changed.");
        return;
      }

      const current = useProfileStore.getState().profile;
      const { patch, restoredFieldCount } = mergeProfileFromBackup(current, document);
      if (restoredFieldCount === 0) {
        setMessage("Nothing recognizable was in that file — nothing was changed.");
        return;
      }

      // Never a raw overwrite of the imported object — `patch` is already
      // the P4-merged result (backup wins single values, union for lists).
      // Signed in, this is exactly the same kind of local profile change any
      // edit makes, so the ordinary debounced sync in profile-sync.tsx picks
      // it up and saves it to the account on its own; nothing more to do
      // here.
      useProfileStore.setState((s) => ({ profile: { ...s.profile, ...patch } }));

      const plural = restoredFieldCount === 1 ? "" : "s";
      setMessage(
        signedIn
          ? `Restored ${restoredFieldCount} signal${plural} from the backup — saving to your account now.`
          : `Restored ${restoredFieldCount} signal${plural} from the backup to this device only. Sign in to save it to your account.`,
      );
    } catch {
      setMessage("Couldn't read that file — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the exact same file again still fires onChange.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-meta text-text-faint hover:text-accent transition-colors disabled:opacity-50"
      >
        {busy ? "Reading…" : "Restore from a backup file"}
      </button>
      {message && (
        <p className="mt-1.5 text-caption text-text-faint leading-relaxed measure-ui">
          {message}
        </p>
      )}
    </div>
  );
}
