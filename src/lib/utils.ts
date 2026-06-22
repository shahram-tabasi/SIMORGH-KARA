/** Build a URL-safe slug from an arbitrary (possibly Persian) name. */
export function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "co";
}

/** Short random token for uniqueness (lowercase alphanumeric). */
export function shortId(len = 5): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function schemaNameFromSlug(slug: string): string {
  return `tenant_${slug.replace(/-/g, "_")}`;
}
