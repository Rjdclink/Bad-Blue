import CanonicalSignupsPanel from "@/components/CanonicalSignupsPanel";
import { SEOHead } from "@/components/SEOHead";

/**
 * Third master navigation destination: the exact same signup registry shown
 * inside the Administrator console, without its unrelated control panels.
 * App.tsx mounts this route for an authenticated master session only.
 */
export default function MasterSignupsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-950/20 to-gray-900 text-white">
      <SEOHead
        title="Master Signups | LegalWhat"
        description="Private LegalWhat master registration dashboard"
        noIndex
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <header className="mb-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">
            Master administration
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">Website Signups</h1>
          <p className="mt-2 text-sm text-gray-400">
            Browse the people registered for LegalWhat. Use the arrows at the top to move to
            CryptoCrawler or LEXARA; the sequence wraps around in either direction.
          </p>
        </header>
        <CanonicalSignupsPanel />
      </main>
    </div>
  );
}
