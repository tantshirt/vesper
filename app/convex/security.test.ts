import { afterEach, describe, expect, test, vi } from "vitest";
import {
  developmentStubEnabled,
  requireDevelopmentStub,
  seedWritesEnabled,
  stepUpEnabled,
  unsafeStubsEnabled,
} from "./security";

afterEach(() => vi.unstubAllEnvs());

describe("development-only provider seams", () => {
  test.each([
    ["kyc", "VESPER_ENABLE_KYC_STUB"],
    ["funding", "VESPER_ENABLE_FUNDING_STUB"],
    ["kyb", "VESPER_ENABLE_KYB_STUB"],
    ["aml", "VESPER_ENABLE_AML_STUB"],
    ["extraction", "VESPER_ENABLE_EXTRACTION_STUB"],
    ["dvp", "VESPER_ENABLE_DVP_STUB"],
    ["eligibilityAttestation", "VESPER_ENABLE_ELIGIBILITY_ATTEST_STUB"],
  ] as const)("production refuses %s even when %s=true", (feature, flag) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(flag, "true");

    expect(developmentStubEnabled(feature)).toBe(false);
    expect(() => requireDevelopmentStub(feature, `${feature} seam`)).toThrow(
      "is disabled until a server-attested provider is configured",
    );
  });

  test("the removed global flag cannot enable any provider seam", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_UNSAFE_STUBS", "true");

    expect(developmentStubEnabled("kyc")).toBe(false);
    expect(developmentStubEnabled("funding")).toBe(false);
    expect(unsafeStubsEnabled()).toBe(false);
  });

  test("a dedicated flag alone cannot enable a seam", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_KYC_STUB", "true");

    expect(developmentStubEnabled("kyc")).toBe(false);
  });

  test("an explicit development runtime and dedicated flag enable only that seam", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_KYC_STUB", "true");

    expect(developmentStubEnabled("kyc")).toBe(true);
    expect(developmentStubEnabled("funding")).toBe(false);
  });

  test("production refuses the step-up stub even when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VESPER_RUNTIME_ENV", "production");
    vi.stubEnv("VESPER_ENABLE_STEP_UP_STUB", "true");
    expect(stepUpEnabled()).toBe(false);
  });

  test("step-up requires both the development runtime and its flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_STEP_UP_STUB", "true");
    expect(stepUpEnabled()).toBe(false);

    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    expect(stepUpEnabled()).toBe(true);
  });

  test("seed writes require both the development runtime and their dedicated flag", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VESPER_ENABLE_DEMO_SEED", "true");
    expect(seedWritesEnabled()).toBe(false);

    vi.stubEnv("VESPER_RUNTIME_ENV", "development");
    expect(seedWritesEnabled()).toBe(true);
  });

  test("tests remain deterministic without environment flags", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(developmentStubEnabled("kyc")).toBe(true);
    expect(developmentStubEnabled("funding")).toBe(true);
    expect(stepUpEnabled()).toBe(true);
    expect(seedWritesEnabled()).toBe(true);
  });
});
