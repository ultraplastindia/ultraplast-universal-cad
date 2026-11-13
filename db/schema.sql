-- Ultraplast Conveyor Designer: Neon (PostgreSQL) tables.
-- The website creates these automatically the first time it runs, so you normally do NOT need to run this file.
-- It is provided so you can see the structure, or create the tables by hand in the Neon "SQL Editor".
-- Every statement is "IF NOT EXISTS": running it again never deletes or changes existing data.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,          -- scrypt hash, never the password itself
  is_admin boolean NOT NULL DEFAULT false,  -- true for the first account created
  created_at timestamptz NOT NULL DEFAULT now()
);

-- added in v0.6 (email codes, settings, AI): extra columns and tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'engineer';   -- admin | engineer | employee | viewer
UPDATE users SET role = 'admin' WHERE is_admin AND role <> 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;  -- new sign-ups start as false until the administrator approves
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS settings (        -- administrator settings; secrets (API keys, mail password) are stored encrypted
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otp_codes (       -- one-time email codes (only a hash is stored)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, purpose text NOT NULL, code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_idx ON otp_codes (email, purpose, created_at DESC);
CREATE TABLE IF NOT EXISTS ai_usage (        -- AI calls per user per day (daily limit)
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL DEFAULT current_date, n int NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS designs (      -- saved designs ('project') and assemblies ('assembly'), including custom and image-made parts
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('project','assembly')),
  name text NOT NULL,
  family_id text,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS designs_owner_idx ON designs (owner_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS uploads (      -- pictures used by Image to 3D (resized, stored as base64 text)
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  data text NOT NULL,
  design_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reference_data ( -- copy of the built-in catalogue, materials, chain, bearing, key and component tables
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS component_types ( -- the component type library (Component types page); the administrator can add or change types
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  base text NOT NULL,                   -- which family or tool creates it (for example sprocket_types, custom_block, assembly)
  kind text NOT NULL DEFAULT 'value',   -- dedicated | value | assembly
  params jsonb NOT NULL DEFAULT '{}'::jsonb, -- the starting values
  note text NOT NULL DEFAULT '',
  builtin boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_attempts ( -- failed sign-in attempts (slows down password guessing)
  email text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_idx ON auth_attempts (email, at DESC);
