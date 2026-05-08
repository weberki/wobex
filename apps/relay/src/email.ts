import nodemailer from "nodemailer";

import type { RelayServiceConfig } from "./config";

export interface RelayEmailLoginCodeInput {
  readonly email: string;
  readonly code: string;
  readonly deviceLabel: string;
  readonly expiresAt: string;
}

export interface RelayEmailSendResult {
  readonly deliveryHint: string;
}

export interface RelayEmailSender {
  sendLoginCode(input: RelayEmailLoginCodeInput): Promise<RelayEmailSendResult>;
}

export function createRelayEmailSender(config: RelayServiceConfig): RelayEmailSender | null {
  if (!config.emailFrom || !config.smtpHost) {
    return null;
  }
  const emailFrom = config.emailFrom;

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort ?? (config.smtpSecure ? 465 : 587),
    secure: config.smtpSecure ?? false,
    ...(config.smtpUser
      ? {
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword ?? "",
          },
        }
      : {}),
  });

  return {
    async sendLoginCode(input) {
      await transport.sendMail({
        from: emailFrom,
        to: input.email,
        ...(config.emailReplyTo ? { replyTo: config.emailReplyTo } : {}),
        subject: "Your Wobex sign-in code",
        text: buildRelayLoginEmailText(input),
      });
      return {
        deliveryHint: `Sent to ${maskEmailAddress(input.email)}`,
      };
    },
  };
}

export function buildRelayLoginEmailText(input: RelayEmailLoginCodeInput): string {
  return [
    "Your Wobex sign-in code:",
    "",
    input.code,
    "",
    `Device: ${input.deviceLabel}`,
    `Expires: ${input.expiresAt}`,
    "",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
}

export function maskEmailAddress(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) {
    return "your email";
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  const visibleLocal = local.slice(0, Math.min(2, local.length));
  const maskedLocal = `${visibleLocal}${"*".repeat(Math.max(1, local.length - visibleLocal.length))}`;
  return `${maskedLocal}@${domain}`;
}
