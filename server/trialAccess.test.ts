import assert from "node:assert/strict";
import test from "node:test";
import {
  getLegalWhatAccessState,
  getTrialRemainingMilliseconds,
  LEGALWHAT_TRIAL_DURATION_MS,
} from "./trialAccess";

const start = Date.parse("2026-09-27T12:00:00.000Z");
const trial = {
  status: "pending_payment",
  hasPaidForAccess: false,
  trialStartedAt: new Date(start).toISOString(),
  trialExpiresAt: new Date(start + LEGALWHAT_TRIAL_DURATION_MS).toISOString(),
  trialConsumedAt: new Date(start).toISOString(),
};

test("an eligible account's first grant is exactly 72 hours", () => {
  assert.equal(
    Date.parse(trial.trialExpiresAt) - Date.parse(trial.trialStartedAt),
    72 * 60 * 60 * 1000,
  );
  assert.equal(getLegalWhatAccessState(trial, start), "trial_active");
  assert.equal(getTrialRemainingMilliseconds(trial, start), LEGALWHAT_TRIAL_DURATION_MS);
});

test("trial access is active immediately before expiry and expires at the exact boundary", () => {
  const expiresAt = start + LEGALWHAT_TRIAL_DURATION_MS;
  assert.equal(getLegalWhatAccessState(trial, expiresAt - 1), "trial_active");
  assert.equal(getLegalWhatAccessState(trial, expiresAt), "trial_expired");
  assert.equal(getLegalWhatAccessState(trial, expiresAt + 1), "trial_expired");
  assert.equal(getTrialRemainingMilliseconds(trial, expiresAt), 0);
});

test("browser-supplied time is not part of the server access policy inputs", () => {
  assert.equal(getLegalWhatAccessState(trial, start + 1), "trial_active");
  assert.equal(getLegalWhatAccessState(trial, start + LEGALWHAT_TRIAL_DURATION_MS), "trial_expired");
});

test("verified paid access and master bypass retain precedence", () => {
  assert.equal(
    getLegalWhatAccessState({ ...trial, status: "active", hasPaidForAccess: true }, start),
    "paid",
  );
  assert.equal(getLegalWhatAccessState({ ...trial, status: "suspended", isMasterBypass: true }, start), "master");
  assert.equal(
    getLegalWhatAccessState({ ...trial, status: "suspended", hasPaidForAccess: true }, start),
    "no_access",
  );
});

test("missing or malformed trial fields fail closed", () => {
  assert.equal(getLegalWhatAccessState({ status: "pending_payment" }, start), "no_access");
  assert.equal(
    getLegalWhatAccessState({ ...trial, trialExpiresAt: "not-a-date" }, start),
    "no_access",
  );
  assert.equal(
    getLegalWhatAccessState({ ...trial, trialExpiresAt: new Date(start + 1000).toISOString() }, start),
    "no_access",
  );
});