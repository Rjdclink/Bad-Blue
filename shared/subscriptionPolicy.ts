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
