CREATE TABLE articles (
  source_url TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL
);

CREATE TABLE article_snapshots (
  source_url TEXT NOT NULL REFERENCES articles(source_url),
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  title TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source_url, version)
);
