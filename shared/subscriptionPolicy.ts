/** Account entry pages are the only document routes available before payment. */
export const SUBSCRIPTION_ENTRY_PATHS = new Set([
  "/login",
  "/subscription-required",
  "/subscription-success",
  "/trial-expired",
  "/trial-upgrade",
  "/trial-review",
  "/privacy",
  "/terms",
  "/contact",
  "/support",
]);

export function normalizeSubscriptionPath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname.split("?")[0]);
    if (!decoded.startsWith("/") || /[\\\u0000-\u001f%]/.test(decoded)) return null;
    if (decoded.split("/").some(part => part === "." || part === "..")) return null;
    return decoded.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return null;
  }
}

export function isSubscriptionEntryPath(pathname: string): boolean {
  const path = normalizeSubscriptionPath(pathname);
  return path !== null && SUBSCRIPTION_ENTRY_PATHS.has(path);
}

/** Trial state is retained for account history, but does not grant paid access. */
export function isPaidAccessState(state: unknown): boolean {
  return state === "paid" || state === "master";
}

/**
 * Public, informational SPA pages. The paid legal consultation, Lexara,
 * Spectra, member workspaces and APIs are deliberately absent.
 *
 * The SEO-only HTML landing pages in /public are admitted separately after
 * checking that they exist on disk AND are in the curated sitemap.
 */
export const PUBLIC_MARKETING_APP_PATHS = new Set([
  "/", "/landing", "/about", "/faq", "/reviews", "/contact", "/privacy", "/terms",
]);

export function isPublicMarketingAppPath(pathname: string): boolean {
  const path = normalizeSubscriptionPath(pathname);
  return path !== null && PUBLIC_MARKETING_APP_PATHS.has(path);
}
