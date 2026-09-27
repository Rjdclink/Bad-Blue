export const LEGALWHAT_TRIAL_DURATION_MS = 72 * 60 * 60 * 1000;

export type LegalWhatAccessState =
  | "master"
  | "paid"
  | "trial_active"
  | "trial_expired"
  | "no_access";

export type TrialActivationOutcome = "ELIGIBLE" | "CLEAR_REPEAT" | "AMBIGUOUS";

export interface TrialAccessSubject {
  status?: string | null;
  hasPaidForAccess?: boolean;
  trialStartedAt?: string | Date | null;
  trialExpiresAt?: string | Date | null;
  trialConsumedAt?: string | Date | null;
  isMasterBypass?: boolean;
  isAdminBypass?: boolean;
  isAdmin?: boolean;
}

const PAID_BLOCKED_STATUSES = new Set(["suspended", "past_due", "canceled", "expired"]);

function timestamp(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLegalWhatAccessState(
  subject: TrialAccessSubject | null | undefined,
  now = Date.now(),
): LegalWhatAccessState {
  if (!subject) return "no_access";
  if (subject.isMasterBypass || subject.isAdminBypass || subject.isAdmin) return "master";

  const status = String(subject.status || "").trim().toLowerCase();
  if (status === "suspended") return "no_access";

  if (subject.hasPaidForAccess === true && !PAID_BLOCKED_STATUSES.has(status)) {
    return "paid";
  }

  const startedAt = timestamp(subject.trialStartedAt);
  const expiresAt = timestamp(subject.trialExpiresAt);
  const consumedAt = timestamp(subject.trialConsumedAt);
  if (startedAt === null || expiresAt === null || consumedAt === null) return "no_access";
  if (expiresAt <= now) return "trial_expired";
  if (startedAt <= now && consumedAt <= now && expiresAt - startedAt === LEGALWHAT_TRIAL_DURATION_MS) {
    return "trial_active";
  }
  return "no_access";
}

export function getTrialRemainingMilliseconds(
  subject: TrialAccessSubject | null | undefined,
  now = Date.now(),
): number {
  if (getLegalWhatAccessState(subject, now) !== "trial_active") return 0;
  const expiresAt = timestamp(subject?.trialExpiresAt);
  return expiresAt === null ? 0 : Math.max(0, expiresAt - now);
}