import { describe, expect, it } from "vitest";
import {
  hasAttemptsRemaining,
  hasCompleteAuthenticationSequence,
  nextWebAuthnFactor,
  isAppSessionActive,
  isTotpStepFresh,
  roleCanAccess,
} from "./policies";
import {
  adminStudentSearchSchema,
  studentCourseRegistrationSchema,
  studentProfileUpdateSchema,
} from "../validation/student";
import { totpRecoveryCodeSchema } from "../validation/auth";
import { AUTH_TRANSACTION_TTL_SECONDS } from "./transaction";

describe("authentication transaction policies", () => {
  it("allows fifteen minutes for the factor transaction", () => {
    expect(AUTH_TRANSACTION_TTL_SECONDS).toBe(15 * 60);
  });

  it("accepts normalized one-time recovery codes and rejects malformed values", () => {
    expect(totpRecoveryCodeSchema.safeParse({ recoveryCode: "abcd1234efgh" }).success).toBe(true);
    expect(totpRecoveryCodeSchema.safeParse({ recoveryCode: "ABCD1234EFGH" }).success).toBe(true);
    expect(totpRecoveryCodeSchema.safeParse({ recoveryCode: "short" }).success).toBe(false);
    expect(totpRecoveryCodeSchema.safeParse({ recoveryCode: "abcd 1234 efgh" }).success).toBe(false);
  });
});

describe("application authorization policies", () => {
  it("allows only the roles assigned to an API surface", () => {
    expect(roleCanAccess("STUDENT", ["STUDENT"])).toBe(true);
    expect(roleCanAccess("ADMIN", ["ADMIN", "SUPER_ADMIN"])).toBe(true);
    expect(roleCanAccess("STUDENT", ["ADMIN", "SUPER_ADMIN"])).toBe(false);
  });

  it("rejects expired and revoked sessions", () => {
    const now = Date.parse("2026-11-04T20:00:00.000Z");
    expect(isAppSessionActive("2026-11-04T21:00:00.000Z", null, now)).toBe(true);
    expect(isAppSessionActive("2026-11-04T19:00:00.000Z", null, now)).toBe(false);
    expect(isAppSessionActive("2026-11-04T21:00:00.000Z", "2026-11-04T19:30:00Z", now)).toBe(false);
    expect(isAppSessionActive("not-a-date", null, now)).toBe(false);
  });

  it("stops factor attempts at the configured maximum", () => {
    expect(hasAttemptsRemaining(4, 5)).toBe(true);
    expect(hasAttemptsRemaining(5, 5)).toBe(false);
    expect(hasAttemptsRemaining(-1, 5)).toBe(false);
  });

  it("rejects TOTP timestep replay", () => {
    expect(isTotpStepFresh(100, 99)).toBe(true);
    expect(isTotpStepFresh(100, 100)).toBe(false);
    expect(isTotpStepFresh(99, 100)).toBe(false);
  });

  it("uses passkey enrollment when a previous enrollment stopped before passkey setup", () => {
    expect(nextWebAuthnFactor(0)).toBe("WEBAUTHN_REGISTRATION");
    expect(nextWebAuthnFactor(1)).toBe("WEBAUTHN_AUTHENTICATION");
  });

  it("requires all three consumed, timestamped factors in sequence", () => {
    const complete = [
      { factor: "PASSWORD_TRANSACTION", verified_at: "2026-11-04T19:00:00Z", consumed_at: "2026-11-04T19:02:00Z" },
      { factor: "TOTP", verified_at: "2026-11-04T19:03:00Z", consumed_at: "2026-11-04T19:03:00Z" },
      { factor: "WEBAUTHN_AUTHENTICATION", verified_at: "2026-11-04T19:04:00Z", consumed_at: "2026-11-04T19:04:00Z" },
    ];
    expect(hasCompleteAuthenticationSequence(complete)).toBe(true);
    expect(hasCompleteAuthenticationSequence(complete.slice(0, 2))).toBe(false);
    expect(hasCompleteAuthenticationSequence([
      complete[0],
      { ...complete[1], verified_at: null },
      complete[2],
    ])).toBe(false);
    expect(hasCompleteAuthenticationSequence([
      complete[0],
      { ...complete[1], verified_at: "2026-11-04T19:05:00Z" },
      complete[2],
    ])).toBe(false);
    expect(hasCompleteAuthenticationSequence([
      ...complete,
      { ...complete[2], factor: "WEBAUTHN_REGISTRATION" },
    ])).toBe(false);
  });
});

describe("protected API input validation", () => {
  it("rejects unknown profile fields and empty profile updates", () => {
    expect(studentProfileUpdateSchema.safeParse({ address: "Kampala" }).success).toBe(true);
    expect(studentProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(studentProfileUpdateSchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
  });

  it("requires UUIDs for student course registration", () => {
    expect(studentCourseRegistrationSchema.safeParse({
      courseId: "8aa8129f-8011-4f15-99e9-e9bf0eb8c304",
      semesterId: "2b7aa7bc-4e51-4d15-a5ef-d764c721c54f",
    }).success).toBe(true);
    expect(studentCourseRegistrationSchema.safeParse({
      courseId: "not-a-uuid",
      semesterId: "2b7aa7bc-4e51-4d15-a5ef-d764c721c54f",
    }).success).toBe(false);
  });

  it("rejects wildcard and malformed admin directory searches", () => {
    expect(adminStudentSearchSchema.safeParse({ search: "STJ/2025/00123" }).success).toBe(true);
    expect(adminStudentSearchSchema.safeParse({ search: "%" }).success).toBe(false);
    expect(adminStudentSearchSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});
