CREATE TABLE IF NOT EXISTS shared_valuation_versions (
 id VARCHAR(120) NOT NULL PRIMARY KEY,
 workspace_id CHAR(36) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 payload_json MEDIUMTEXT NOT NULL,
 audit_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX valuation_workspace(workspace_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
