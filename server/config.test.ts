import assert from "node:assert/strict";
import test from "node:test";
import { applySquareSandboxAliases } from "./config";

const base = {
  SQUARE_ENVIRONMENT: "sandbox" as const,
  SQUARE_SANDBOX_ACCESS_TOKEN: undefined,
  SQUARE_SANDBOX_TOKEN: "sandbox-token",
  SQUARE_APPLICATION_ID: "",
  SQUARE_SANDBOX_ID: "sandbox-app-id",
};

test("sandbox aliases populate the Square sandbox token and application ID", () => {
  const normalized = applySquareSandboxAliases(base);
  assert.equal(normalized.SQUARE_SANDBOX_ACCESS_TOKEN, "sandbox-token");
  assert.equal(normalized.SQUARE_APPLICATION_ID, "sandbox-app-id");
});

test("explicit Square sandbox configuration takes precedence over aliases", () => {
  const normalized = applySquareSandboxAliases({
    ...base,
    SQUARE_SANDBOX_ACCESS_TOKEN: "explicit-token",
    SQUARE_APPLICATION_ID: "explicit-app-id",
  });
  assert.equal(normalized.SQUARE_SANDBOX_ACCESS_TOKEN, "explicit-token");
  assert.equal(normalized.SQUARE_APPLICATION_ID, "explicit-app-id");
});

test("sandbox aliases do not populate production Square credentials", () => {
  const normalized = applySquareSandboxAliases({
    ...base,
    SQUARE_ENVIRONMENT: "production",
  });
  assert.equal(normalized.SQUARE_SANDBOX_ACCESS_TOKEN, undefined);
  assert.equal(normalized.SQUARE_APPLICATION_ID, "");
});