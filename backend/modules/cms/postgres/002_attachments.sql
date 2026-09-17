CREATE TABLE IF NOT EXISTS cms_attachments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES cms_users(id),
  path text NOT NULL,
  original_name text,
  mime varchar(255),
  size_bytes bigint NOT NULL DEFAULT 0,
  sha256 char(64) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (owner_id, path)
);

CREATE INDEX IF NOT EXISTS cms_attachments_owner_updated_idx
  ON cms_attachments(owner_id, updated_at DESC) WHERE deleted_at IS NULL;
