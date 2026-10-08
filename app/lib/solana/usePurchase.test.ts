import { describe, expect, test } from "vitest";
import { confirmationPresentation } from "./usePurchase";

describe("purchase confirmation presentation", () => {
  test.each([
    [{ status: "confirmed" as const, unresolved: 0 }, "complete"],
    [{ status: "confirmed" as const, unresolved: 1 }, "reconciling"],
    [{ status: "failed-safe" as const }, "failed_safe"],
    [{ status: "expired-safe" as const }, "failed_safe"],
    [{ status: "not-found" as const }, "outcome_unknown"],
    [{ status: "rpc-error" as const }, "outcome_unknown"],
  ])("maps %j truthfully", (result, status) => {
    expect(confirmationPresentation(result)).toMatchObject({ status });
  });
});
