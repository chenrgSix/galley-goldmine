CREATE TABLE assets_new (
  id TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'mermaid', 'katex', 'cover', 'scene')),
  source TEXT,
  cache_key TEXT UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);

INSERT INTO assets_new (id, sha256, kind, source, cache_key, mime, bytes, width, height)
  SELECT id, sha256, kind, source, cache_key, mime, bytes, width, height FROM assets;
DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;
