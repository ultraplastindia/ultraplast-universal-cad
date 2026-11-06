import { neon } from '@neondatabase/serverless';

/** The database connection string and the login secret come only from environment variables set in Vercel. */
export const configured = (): boolean => Boolean(process.env.DATABASE_URL) && (process.env.AUTH_SECRET ?? '').length >= 32;
export const secret = (): string => process.env.AUTH_SECRET ?? '';

/** Tagged-template query function: sql()`SELECT ... WHERE id = ${id}` sends the values as safe parameters (never pasted into the text). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;
let client: Sql | null = null;
export function sql(): Sql { client ??= neon(process.env.DATABASE_URL as string) as unknown as Sql; return client; }

let ready: Promise<void> | null = null;
/** Creates the tables the first time (safe to repeat: only "IF NOT EXISTS", never deletes or changes existing data). Same as db/schema.sql. */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const q = sql();
    await q`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL DEFAULT '', password_hash text NOT NULL, is_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS designs (id text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('project','assembly')), name text NOT NULL, family_id text, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE INDEX IF NOT EXISTS designs_owner_idx ON designs (owner_id, kind, updated_at DESC)`;
    await q`CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, mime text NOT NULL, data text NOT NULL, design_id text, created_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads (owner_id, created_at DESC)`;
    await q`CREATE TABLE IF NOT EXISTS reference_data (key text PRIMARY KEY, data jsonb NOT NULL, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE TABLE IF NOT EXISTS auth_attempts (email text NOT NULL, at timestamptz NOT NULL DEFAULT now())`;
    await q`CREATE INDEX IF NOT EXISTS auth_attempts_idx ON auth_attempts (email, at DESC)`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
