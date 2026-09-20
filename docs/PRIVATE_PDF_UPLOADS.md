# Private PDF uploads — storage, retention, and legal boundaries

This document restates, in plain words, what Peer actually does when a reader uploads their
own PDF (either as a standalone paper, or to supplement a report Peer generated from a
paywalled source). It is written for readers of this repository, not as a substitute for the
consent screen shown in the product — if the two ever disagree, treat that as a bug and fix the
code or this document, not the other way around.

**This document is not legal advice, and nothing in it or in the product guarantees that any
particular upload is lawful.** See "What this does *not* establish" below.

## What gets stored, and who can read it

- An uploaded PDF's bytes and its extracted metadata (title, DOI when found, a short abstract
  excerpt, and a handful of extracted phrases used for learning — never the full text) are
  written to a private, gitignored directory on the server (`web/.local-data/uploads/` locally;
  a real deployment must point `PEER_PRIVATE_UPLOAD_DIR` at its own private, durable volume —
  see `web/.env.example`).
- Every record is tagged with an **owner key** derived from either the signed-in account
  (production) or a per-browser capability cookie (local development only — never a shared
  identity). Every route that reads an upload's bytes, metadata, generated report, or figures
  checks this owner key first; a different account or an unauthenticated request gets a plain
  "not found," not a permissions error that would confirm the upload exists.
- Nothing about an uploaded PDF — its bytes, its extracted text, or its derived report/figures —
  is written into any shared, cross-account cache. A daily candidate pool used for
  recommendations can be *ranked* using a short list of a user's own upload-derived interest
  terms, but the pool's contents and any other reader's results are unaffected.

## What the consent screen asserts

Before an upload is stored or processed, the reader must explicitly check a box agreeing to
this text (`components/briefing/upload-consent-dialog.tsx`, kept in sync with the actual
behavior below, not the other way around):

> Your PDF stays private to your account (or this browser in local development) for 30 days.
> Peer uses its keywords to learn your interests. You can delete the PDF and its learned
> signals. Reports may send article text and figures to your configured AI provider under that
> provider's terms.
>
> I am authorized to upload, store and process this article in Peer, including with my AI
> provider. Having subscription access alone may not grant these permissions.
>
> Only upload authorized copies. Peer does not bypass paywalls or share your PDF with other
> readers.

The server records which version of this rights text a reader agreed to and when
(`rightsVersion` / `rightsAcceptedAt`), and refuses an upload made under a stale or missing
version — the consent is checked, not merely displayed.

## Retention: 30 days, and what "expires" actually means

- **30 days is a design choice made for this project, not a value required by any law.** A
  different deployment is free to choose a different window, as long as the code, the consent
  text, and this document all agree.
- Two separate things happen on different schedules, and readers should not conflate them:
  1. **File and metadata expiry.** An upload's bytes and metadata are refused to every route —
     including the owner's own — the instant the 30-day mark passes, whether or not the physical
     files have been deleted yet.
  2. **Physical deletion.** The bytes and metadata are actually removed from disk by a scheduled
     job, `GET /api/jobs/purge-uploads` (a timing-safe `Authorization: Bearer <CRON_SECRET>`
     check; wrong or missing secret is refused). Every new upload also opportunistically sweeps
     already-expired records as a side effect, but that is a supplement to the scheduled job, not
     a replacement for one — **an install that never runs the schedule will accumulate expired
     files it has already stopped serving.**
- **Learned preferences are a separate lifecycle from the file.** Deleting or expiring the PDF
  does not, by itself, retroactively decay or remove the taste-profile evidence it already
  contributed; a reader can also explicitly "forget" that evidence (see below) independent of
  whether the file itself is deleted.
- Backups, legal holds, and any processing already performed by a reader's configured AI
  provider are **not** covered by this 30-day window or by an in-app delete — see the AI-provider
  section below. Deleting an upload in Peer cannot reach into, or recall data from, a third-party
  system.

## Deleting or "forgetting" an upload

- **Delete PDF** removes the file and its metadata outright (via the owner-authenticated
  `DELETE /api/papers/upload/[id]` route). If another of the owner's own live uploads is a
  verified copy of the same logical document (matched by DOI, never by filename), that other
  copy's learning evidence is left untouched — deleting one copy of a paper you uploaded twice
  does not erase the interest signal the surviving copy still justifies.
- **Forget what Peer learned from this** removes only the ledger evidence a specific upload
  contributed, without deleting the PDF itself — for a reader who wants to keep their file but
  says the paper does not represent their interests.

## Sending content to an AI provider

- Full text and figures are only ever sent to the AI provider **the reader has configured** —
  never to an operator-wide fallback for someone else's private upload — and only when a deep
  report is actually requested.
- Private uploads are excluded from the automatic figure-matching model call and from the
  title-recovery model fallback beyond the PDF's own first page, specifically to minimize what a
  private document exposes to a model call.
- **Peer does not control, and cannot promise, what a third-party AI provider does with content
  once sent to it.** Each provider has its own retention and training terms; read them before
  choosing a provider for private material. This product cannot make a "this provider will never
  store or train on your data" promise on any provider's behalf.

## The operator takedown path

Deletion is not solely in the uploading reader's hands. An operator holding the deployment's
`ADMIN_TOKEN` secret can call `POST /api/admin/uploads/block` with an upload's id to
immediately: remove the stored PDF bytes, replace the metadata with a minimal record that can
never be re-claimed by a future upload of the same bytes, and retract the shared learning
evidence (unless another live copy of the same document still justifies it, using the same
reference-counting rule the reader-facing delete path uses). This route reveals its own
existence only when `ADMIN_TOKEN` is actually configured — an unconfigured deployment answers
identically to a route that does not exist. This is the mechanism a copyright complaint or other
takedown request would be handled through; it is not itself a takedown *process* (see "open
conditions" below).

## Running the retention schedule

Neither of the following runs by itself just because this repository exists — **a fresh local
checkout purges nothing until one of these is actually configured**:

- **Vercel deployment:** the repo-root `vercel.json` declares a daily cron entry
  (`{"crons":[{"path":"/api/jobs/purge-uploads","schedule":"17 3 * * *"}]}`). Set `CRON_SECRET`
  in the Vercel project's environment variables; Vercel calls the route with that bearer
  automatically.
- **Self-hosting:** run `npm run purge-uploads` (`web/scripts/purge-uploads.mjs`) against an
  already-running instance, with `CRON_SECRET` set in the calling environment, on your own
  OS-level scheduler (`cron`, Task Scheduler, systemd timers, …).

## The legal background this project is not qualified to settle

The engineering measures above — owner isolation, a stated retention window, explicit recorded
consent, minimized third-party exposure, and an operator takedown path — are risk-reduction
measures. **None of them is a legal opinion, and none of them makes an upload lawful by
itself.** In particular:

- **Fair use** is a fact-specific, four-factor U.S. legal test (purpose, nature of the work,
  amount used, and market effect); "for my own research" is one relevant fact among several, not
  an automatic pass for uploading and processing an entire paywalled article. See the U.S.
  Copyright Office's own explanation:
  [copyright.gov — More Information on Fair Use](https://www.copyright.gov/fair-use/more-info.html).
- **DMCA §512 safe harbors** (the rules that can limit a hosting service's liability for
  user-uploaded content) apply only when a service actually meets their conditions — a
  registered and published takedown agent, a public notice-and-takedown process, a repeat-
  infringer policy, and more. **This project does not currently claim, and has not established,
  that it meets those conditions.** See the U.S. Copyright Office's summary
  ([copyright.gov — Section 512](https://www.copyright.gov/512/)) and the statute itself
  ([17 U.S.C. § 512](https://uscode.house.gov/view.xhtml?req=%28title%3A17+section%3A512+edition%3Aprelim%29)).
- **The PDF text/figure extractor depends on PyMuPDF**, which is dual-licensed under the GNU
  AGPL and a commercial license. This repository's own MIT license does not, by itself, resolve
  PyMuPDF's own licensing obligations for how this project builds, integrates, or distributes it.
  See PyMuPDF's own repository and package listing:
  [github.com/pymupdf/PyMuPDF](https://github.com/pymupdf/PyMuPDF) and
  [pypi.org/project/pymupdf](https://pypi.org/project/pymupdf/).
- A subscription that lets a reader *download* a paper does not automatically also grant the
  right to upload it to a third-party service and have that service's chosen AI provider process
  it. Publisher and institutional subscription terms vary and are not evaluated by this project.
- The account holder, the operating entity, the hosting jurisdiction, and every reader's own
  jurisdiction are all unconfirmed for any given deployment of this code — none of the U.S.
  sources above should be read as a global legal conclusion.

### Open conditions — not yet resolved by this codebase

The following remain **open** and are listed here rather than assumed closed by any code in this
repository:

1. A qualified legal reviewer has not confirmed the target jurisdiction(s), the applicable
   publisher/institutional subscription terms, the permitted scope of third-party AI processing,
   or how original text/figures may be used inside a generated private report.
2. No real-world notice-and-takedown process, published complaint contact, repeat-infringer
   policy, or safe-harbor agent registration exists for this project — the operator takedown
   route above is a technical mechanism, not a substitute for that operational and legal setup.
3. Production-scale storage, the retention scheduler, and backup/incident-response procedures
   have not been load-tested or operationally rehearsed outside of local development.
4. PyMuPDF's licensing obligations for this project's actual build and distribution shape have
   not been resolved — via a commercial license, a different extraction dependency, or a legal
   determination that the AGPL terms are already satisfied.

Until these are resolved, an operator should treat hosted uploads as **off by default**
(`PEER_UPLOADS_ENABLED=false` unless explicitly and deliberately turned on) rather than treat a
present environment variable as evidence that these conditions have been met.
