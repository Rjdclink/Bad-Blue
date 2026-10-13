import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SIGNUPS_PER_PAGE = 50;

interface CanonicalLegalWhatSignup {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  hasPaidForAccess: boolean;
  hasLocalCredentials: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

interface CanonicalLegalWhatSignupReport {
  source: "canonical-legalwhat-auth";
  page: number;
  total: number;
  signups: CanonicalLegalWhatSignup[];
}

function displaySignupDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

/**
 * Shared master-only signup registry. Both the dedicated third Master panel
 * and the original Administrator console display the same canonical records.
 */
export default function CanonicalSignupsPanel() {
  const { user, isLoading: authLoading } = useAuth();
  const isMasterSession = Boolean((user as any)?.isMasterBypass);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<CanonicalLegalWhatSignupReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isMasterSession) return;
    let current = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/admin/legalwhat-signups?page=${page}`, {
          credentials: "include",
          headers: { "Cache-Control": "no-store" },
        });
        if (!response.ok) throw new Error(`Signup authority returned HTTP ${response.status}`);

        const result: CanonicalLegalWhatSignupReport = await response.json();
        if (result.source !== "canonical-legalwhat-auth" ||
            !Array.isArray(result.signups) ||
            !Number.isSafeInteger(result.total) ||
            result.total < 0 ||
            result.page !== page) {
          throw new Error("Invalid canonical signup report");
        }

        if (!current) return;
        setReport(result);
        setError("");
      } catch (cause) {
        if (!current) return;
        setReport(null);
        setError(cause instanceof Error ? cause.message : "Signup report is temporarily unavailable");
      } finally {
        if (current) setLoading(false);
      }
    };

    setLoading(true);
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      current = false;
      window.clearInterval(interval);
    };
  }, [isMasterSession, page]);

  const totalPages = Math.max(1, Math.ceil((report?.total || 0) / SIGNUPS_PER_PAGE));

  return (
    <Card className="bg-gray-800/50 border-white/10 mb-6">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Users className="h-5 w-5 text-purple-400" />
          LegalWhat Website Signups
        </CardTitle>
        <CardDescription className="text-gray-400">
          Registered accounts in the canonical LegalWhat authentication database, not website visits or application activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!authLoading && !isMasterSession ? (
          <p className="text-amber-300">Master sign-in is required to view registrations.</p>
        ) : loading && !report ? (
          <p className="text-gray-400" role="status">Loading registered users…</p>
        ) : error ? (
          <p className="text-amber-300" role="alert">Signup report unavailable: {error}</p>
        ) : report ? (
          <div className="space-y-3">
            <p className="text-lg font-semibold text-white">
              <span className="text-3xl tabular-nums">{report.total.toLocaleString()}</span>{" "}
              registered {report.total === 1 ? "profile" : "profiles"}
            </p>
            {report.signups.length === 0 && <p className="text-gray-400">No signup records on this page.</p>}
            {report.signups.map((signup) => (
              <div key={signup.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {[signup.firstName, signup.lastName].filter(Boolean).join(" ") || "Name not provided"}
                  </p>
                  <p className="break-all text-sm text-gray-400">{signup.email}</p>
                  <p className="text-xs text-gray-500">Registered {displaySignupDate(signup.createdAt)}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className="text-gray-300">{signup.status.replace(/_/g, " ")}</p>
                  <p className={signup.hasLocalCredentials ? "text-green-300" : "text-amber-300"}>
                    {signup.hasLocalCredentials ? "Login credentials present" : "Login credentials missing"}
                  </p>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous page of registered users"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <p className="text-sm text-gray-400" aria-live="polite">
                Page {report.page} of {totalPages}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next page of registered users"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-gray-400" role="status">Loading registered users…</p>
        )}
      </CardContent>
    </Card>
  );
}
