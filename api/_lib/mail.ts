import nodemailer from 'nodemailer';
import { getSetting, MAIL_DEFAULT, unseal } from './settings.js';

/** True when the administrator has saved a working mail account and switched sending on. */
export async function mailReady(): Promise<boolean> {
  const m = await getSetting('mail', MAIL_DEFAULT);
  return m.enabled && !!m.host && !!m.user && !!unseal(m.passEnc);
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const m = await getSetting('mail', MAIL_DEFAULT), pass = unseal(m.passEnc);
  if (!m.host || !m.user || !pass) throw new Error('Email sending is not set up. Open Settings > Email.');
  const transport = nodemailer.createTransport({ host: m.host, port: m.port, secure: m.secure, requireTLS: !m.secure, auth: { user: m.user, pass }, connectionTimeout: 10000, socketTimeout: 15000 });
  await transport.sendMail({ from: `"${m.fromName.replace(/"/g, '')}" <${m.fromEmail || m.user}>`, to, subject, text });
}

export const otpText = (code: string, purpose: string): { subject: string; text: string } => ({
  subject: `Your Ultraplast verification code: ${code}`,
  text: `Your code is ${code}\n\nIt is valid for 10 minutes and works once. ${purpose === 'reset' ? 'It was requested to reset your password.' : purpose === 'login' ? 'It was requested to sign in.' : 'It was requested to confirm your email address.'}\nIf you did not ask for this, ignore this email: nobody can sign in without the code and your password.\n\nUltraplast Conveyor Designer`,
});
