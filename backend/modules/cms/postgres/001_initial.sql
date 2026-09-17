CREATE TABLE IF NOT EXISTS cms_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_users (
  id uuid PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  role varchar(20) NOT NULL DEFAULT 'editor',
  password_hash varchar(255),
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS cms_navigation_items (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  legacy_key varchar(255) NOT NULL,
  label varchar(255) NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('docs', 'notebook', 'page')),
  content_key varchar(255),
  content text,
  sort_order integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS cms_categories (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  legacy_key varchar(255) NOT NULL,
  label varchar(255) NOT NULL,
  parent_id uuid REFERENCES cms_categories(id),
  sort_order integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS cms_category_notebooks (
  category_id uuid NOT NULL REFERENCES cms_categories(id) ON DELETE CASCADE,
  notebook_id uuid NOT NULL REFERENCES cms_navigation_items(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, notebook_id)
);

CREATE SEQUENCE IF NOT EXISTS cms_note_legacy_id_seq;

CREATE TABLE IF NOT EXISTS cms_notes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  legacy_id bigint NOT NULL DEFAULT nextval('cms_note_legacy_id_seq'),
  notebook_id uuid REFERENCES cms_navigation_items(id),
  category_id uuid REFERENCES cms_categories(id),
  title varchar(500) NOT NULL,
  content text NOT NULL DEFAULT '',
  description varchar(500) NOT NULL DEFAULT '',
  excerpt text NOT NULL DEFAULT '',
  note_date date,
  read_time varchar(50),
  starred boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, legacy_id)
);

CREATE TABLE IF NOT EXISTS cms_tags (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  name varchar(255) NOT NULL,
  normalized_name varchar(255) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS cms_note_tags (
  note_id uuid NOT NULL REFERENCES cms_notes(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES cms_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS cms_whiteboards (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  legacy_key varchar(32) NOT NULL,
  content text NOT NULL DEFAULT '',
  archives jsonb NOT NULL DEFAULT '[]'::jsonb,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS cms_media_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  legacy_key varchar(255) NOT NULL,
  original_name text NOT NULL,
  mime varchar(255),
  size_bytes bigint,
  duration integer,
  width integer,
  height integer,
  url text NOT NULL,
  poster_url text,
  sha256 char(64),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS cms_idempotency_records (
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  scope varchar(100) NOT NULL,
  mutation_id varchar(100) NOT NULL,
  payload_hash char(64) NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, scope, mutation_id)
);

CREATE TABLE IF NOT EXISTS cms_change_log (
  sequence bigserial PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  entity_type varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  operation varchar(10) NOT NULL CHECK (operation IN ('upsert', 'delete')),
  version bigint NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);

CREATE INDEX IF NOT EXISTS cms_change_log_owner_sequence_idx ON cms_change_log(owner_id, sequence);
CREATE INDEX IF NOT EXISTS cms_notes_owner_updated_idx ON cms_notes(owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cms_notes_owner_deleted_idx ON cms_notes(owner_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cms_categories_owner_parent_idx ON cms_categories(owner_id, parent_id) WHERE deleted_at IS NULL;
