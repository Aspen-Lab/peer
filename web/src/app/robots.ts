// Indexing, on purpose rather than by default.
//
// The reading surfaces are public and worth finding; anything that only makes
// sense for the reader who owns it is not, and `/auth` is never a search
// result. There is no `Disallow: /` here — a product nobody can find is not
// launched.

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/profile", "/saved", "/welcome"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
