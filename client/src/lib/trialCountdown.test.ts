import assert from "node:assert/strict";
import test from "node:test";
import { trialCountdownLabel, trialRemainingAt, trialReminder } from "./trialCountdown";

const hour = 60 * 60 * 1000;

test("a delayed phone timer consumes actual elapsed time, not one nominal tick", () => {
  assert.equal(trialRemainingAt(72 * hour, 25 * hour), 47 * hour);
  assert.equal(trialRemainingAt(72 * hour, 73 * hour), 0);
});

test("trial reminders and labels change at the two-day, one-day and final-hour boundaries", () => {
  assert.equal(trialReminder(72 * hour), null);
  assert.equal(trialReminder(48 * hour)?.key, "two-days");
  assert.equal(trialReminder(24 * hour)?.key, "one-day");
  assert.equal(trialReminder(hour)?.key, "one-hour");
  assert.equal(trialCountdownLabel(30 * 60_000), "30 minutes remaining");
  assert.equal(trialRemainingAt(1000, 1000), 0);
});
