// Where Peer lives, in one place.
//
// `NEXT_PUBLIC_SITE_URL` wins so a custom domain is one Vercel variable rather
// than a code change; `VERCEL_PROJECT_PRODUCTION_URL` is what Vercel sets on
// every deployment of the production project, so previews and production both
// point at something real without hard-coding a host.

export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://hermes-flax-six.vercel.app");

// The public source. Peer is AGPL-3.0-only, and a site that runs AGPL code
// must offer its users the source (AGPL section 13); the footer on every
// page links here. GitHub redirects this address if the repository moves.
export const REPO_URL = "https://github.com/Aspen-Lab/peer";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const LICENSE_NAME = "AGPL-3.0-only";
