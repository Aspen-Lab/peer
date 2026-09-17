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
