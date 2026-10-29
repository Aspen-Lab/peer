export interface Institution {
  id?: string;
  display_name?: string;
  image_thumbnail_url?: string | null;
  image_url?: string | null;
}

export function normalizedName(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Only use Wikimedia-hosted images from the matching OpenAlex record. */
export function institutionLogo(record: Institution | undefined, name: string): string | null {
  if (!record?.display_name || normalizedName(record.display_name) !== normalizedName(name)) return null;
  for (const image of [record.image_thumbnail_url, record.image_url]) {
    if (!image || image.length > 2048) continue;
    try {
      const url = new URL(image);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      if (url.hostname === "upload.wikimedia.org") return url.href;
      if (url.hostname === "commons.wikimedia.org" && url.pathname === "/w/index.php" && url.searchParams.get("title")?.startsWith("Special:Redirect/file/")) return url.href;
    } catch { /* Ignore malformed image URLs. */ }
  }
  return null;
}
