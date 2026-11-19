import "server-only";
import nodemailer from "nodemailer";
import { MongoConfigurationError } from "@/lib/mongodb/config";

function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    throw new MongoConfigurationError(
      "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in .env.local to send emails.",
    );
  }

  return { transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), from };
}

export async function sendInvitationEmail(
  to: string,
  fullName: string,
  tempPassword: string,
  role: "STUDENT" | "ADMIN" | "SUPER_ADMIN",
) {
  const { transport, from } = getSmtpTransport();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const subject =
    role === "STUDENT"
      ? "Your St Jude University Portal Account"
      : "Your St Jude University Admin Portal Access";
  const body = `
Hello ${fullName},

Your ${role === "STUDENT" ? "student" : "administrator"} account has been created on the St Jude University Portal.

Login at: ${appUrl}/login
Email: ${to}
Temporary password: ${tempPassword}

Please sign in and complete your security setup (authenticator app + passkey).

Regards,
St Jude University
  `.trim();

  await transport.sendMail({ from, to, subject, text: body });
}
