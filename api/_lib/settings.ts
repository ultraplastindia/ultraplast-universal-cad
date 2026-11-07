import { decryptSecret, encryptSecret } from './crypto.js';
import { secret, sql } from './db.js';

/** Administrator settings are kept in the `settings` table as JSON. Secrets are stored encrypted (see crypto.ts). */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = (await sql()`SELECT value FROM settings WHERE key = ${key}`) as { value: T }[];
  return rows[0] ? (rows[0].value as T) : fallback;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await sql()`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
export const seal = (plain: string): string => encryptSecret(plain, secret());
export const unseal = (stored: string | undefined | null): string | null => (stored ? decryptSecret(stored, secret()) : null);
export const hint = (plain: string | null): string => (plain ? `••••${plain.slice(-4)}` : '');

export interface MailSettings { enabled: boolean; host: string; port: number; secure: boolean; user: string; passEnc: string; fromName: string; fromEmail: string }
export const MAIL_DEFAULT: MailSettings = { enabled: false, host: '', port: 587, secure: false, user: '', passEnc: '', fromName: 'Ultraplast Conveyor Designer', fromEmail: '' };
export interface SecuritySettings { otpLogin: boolean }
export const SECURITY_DEFAULT: SecuritySettings = { otpLogin: true };
