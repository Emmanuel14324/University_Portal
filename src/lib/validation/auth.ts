import { z } from "zod";

export const passwordLoginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const newPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must not exceed 128 characters.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

export const totpTokenSchema = z.object({
  token: z.string().regex(/^\d{6}$/, "Enter the 6-digit authenticator code."),
});

export const totpRecoveryCodeSchema = z.object({
  recoveryCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{12}$/),
}).strict();

export const webauthnRegistrationSchema = z.object({
  response: z.unknown(),
  deviceName: z.string().trim().min(1).max(80).optional(),
});

export const webauthnAuthenticationSchema = z.object({
  response: z.unknown(),
});
