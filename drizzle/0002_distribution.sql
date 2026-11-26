CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'mermaid', 'katex', 'cover')),
  source TEXT,
  cache_key TEXT UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);

CREATE TABLE platform_builds (
  id TEXT PRIMARY KEY NOT NULL,
  source_url TEXT NOT NULL,
  version INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('wechat', 'toutiao')),
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  cover_asset_id TEXT REFERENCES assets(id),
  html_sha256 TEXT NOT NULL,
  markdown_sha256 TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  warnings TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_url, version) REFERENCES article_snapshots(source_url, version)
);
CREATE UNIQUE INDEX platform_build_revision ON platform_builds(source_url, platform, revision);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL REFERENCES platform_builds(id),
  bundle_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX review_build ON reviews(build_id, id);

CREATE TABLE sync_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL REFERENCES platform_builds(id),
  bundle_sha256 TEXT NOT NULL,
  review_id INTEGER REFERENCES reviews(id),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'sync')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'unknown')),
  draft_url TEXT,
  exit_code INTEGER,
  output_excerpt TEXT,
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  finished_at TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX sync_attempt_build ON sync_attempts(build_id, id);
