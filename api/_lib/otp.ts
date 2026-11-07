import { newOtp, otpHash, sameHash } from './crypto.js';
import { secret, sql } from './db.js';
import { otpText, sendMail } from './mail.js';

/** An error whose message is safe to show to the person. */
export class Friendly extends Error {}
export type Purpose = 'signup' | 'login' | 'reset';
export const PURPOSES: Purpose[] = ['signup', 'login', 'reset'];
const MINUTES = 10, MAX_TRIES = 5;

/** Creates a fresh code (older codes for the same email and purpose stop working) and mails it. Throws a readable message on limits. */
export async function issueOtp(email: string, purpose: Purpose): Promise<void> {
  const q = sql();
  const last = (await q`SELECT extract(epoch FROM now() - created_at)::int AS s FROM otp_codes WHERE email = ${email} AND purpose = ${purpose} ORDER BY created_at DESC LIMIT 1`) as { s: number }[];
  if (last[0] && last[0].s < 30) throw new Friendly(`Wait ${30 - last[0].s} seconds before asking for another code.`);
  const hour = (await q`SELECT count(*)::int AS n FROM otp_codes WHERE email = ${email} AND created_at > now() - interval '1 hour'`) as { n: number }[];
  if ((hour[0]?.n ?? 0) >= 8) throw new Friendly('Too many codes were requested. Try again in an hour.');
  const code = newOtp();
  await q`DELETE FROM otp_codes WHERE email = ${email} AND purpose = ${purpose}`;
  await q`INSERT INTO otp_codes (email, purpose, code_hash, expires_at) VALUES (${email}, ${purpose}, ${otpHash(code, email, purpose, secret())}, now() + ${MINUTES + ' minutes'}::interval)`;
  const m = otpText(code, purpose);
  try { await sendMail(email, m.subject, m.text); }
  catch (e) { await q`DELETE FROM otp_codes WHERE email = ${email} AND purpose = ${purpose}`; throw new Friendly(`The email could not be sent (${e instanceof Error ? e.message : 'mail error'}). Ask the administrator to check Settings > Email.`); }
}

/** True when the code is right, unexpired and unused. A right code is consumed; a wrong one counts as a try. */
export async function checkOtp(email: string, purpose: Purpose, code: string): Promise<boolean> {
  const q = sql();
  const rows = (await q`SELECT id, code_hash, attempts, expires_at < now() AS expired FROM otp_codes WHERE email = ${email} AND purpose = ${purpose} ORDER BY created_at DESC LIMIT 1`) as { id: string; code_hash: string; attempts: number; expired: boolean }[];
  const r = rows[0];
  if (!r || r.expired || r.attempts >= MAX_TRIES) return false;
  if (!/^\d{6}$/.test(code) || !sameHash(r.code_hash, otpHash(code, email, purpose, secret()))) { await q`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${r.id}`; return false; }
  await q`DELETE FROM otp_codes WHERE id = ${r.id}`;
  return true;
}
