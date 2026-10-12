const RECOVERY_KEY = 'legalwhat:page-load-recovery';

// A tab can outlive a deployment and still request its old hashed page files.
// Reload once for that entry bundle; never loop or reload for application bugs.
export function recoverPageDownload(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(message)) {
    return false;
  }

  try {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!entry || sessionStorage.getItem(RECOVERY_KEY) === entry) return false;
    sessionStorage.setItem(RECOVERY_KEY, entry);
    window.location.reload();
    return true;
  } catch {
    // Storage can be disabled. Leave the manual refresh available in that case.
    return false;
  }
}
