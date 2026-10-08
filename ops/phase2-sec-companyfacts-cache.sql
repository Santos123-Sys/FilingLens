-- Phase 2 fallback: immutable-provenance SEC bulk extracts (no companyfacts API scraping).
-- Run once with the schema-migrator's privileged DATABASE_URL.
-- Public XBRL facts only. A vetted operator supplies a CIK JSON member extracted
-- from the SEC's nightly companyfacts.zip, with its archive SHA-256 recorded.
CREATE TABLE IF NOT EXISTS sec_companyfacts_snapshots (
  cik CHAR(10) NOT NULL,
  retrieved_day CHAR(10) NOT NULL,
  archive_sha256 CHAR(64) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  source_url VARCHAR(255) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(cik),
  KEY ix_sec_import_age(retrieved_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
