package requestdb

import (
	"database/sql"
	"fmt"
)

// currentSchemaVersion is the schema revision this binary expects. Bump it and
// add a migration step in migrate whenever the table layout changes.
const currentSchemaVersion = 3

const schemaV1 = `
CREATE TABLE IF NOT EXISTS request_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	requested_at INTEGER NOT NULL,
	request_id TEXT NOT NULL DEFAULT '',
	trace_id TEXT NOT NULL DEFAULT '',
	endpoint TEXT NOT NULL DEFAULT '',
	client_ip TEXT NOT NULL DEFAULT '',
	resolved_client_ip TEXT NOT NULL DEFAULT '',
	x_forwarded_for TEXT NOT NULL DEFAULT '',
	user_agent TEXT NOT NULL DEFAULT '',
	session_id TEXT NOT NULL DEFAULT '',
	parent_session_id TEXT NOT NULL DEFAULT '',
	api_key TEXT NOT NULL DEFAULT '',
	access_provider TEXT NOT NULL DEFAULT '',
	is_native_key INTEGER NOT NULL DEFAULT 0,
	provider TEXT NOT NULL DEFAULT '',
	executor_type TEXT NOT NULL DEFAULT '',
	auth_id TEXT NOT NULL DEFAULT '',
	auth_index TEXT NOT NULL DEFAULT '',
	auth_type TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT '',
	base_url TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	alias TEXT NOT NULL DEFAULT '',
	response_model TEXT NOT NULL DEFAULT '',
	reasoning_effort TEXT NOT NULL DEFAULT '',
	requested_reasoning_effort TEXT NOT NULL DEFAULT '',
	service_tier TEXT NOT NULL DEFAULT '',
	effective_service_tier TEXT NOT NULL DEFAULT '',
	response_service_tier TEXT NOT NULL DEFAULT '',
	generate INTEGER NOT NULL DEFAULT 1,
	stream INTEGER NOT NULL DEFAULT 0,
	failed INTEGER NOT NULL DEFAULT 0,
	status_code INTEGER NOT NULL DEFAULT 0,
	latency_ms INTEGER NOT NULL DEFAULT 0,
	ttft_ms INTEGER NOT NULL DEFAULT 0,
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	reasoning_tokens INTEGER NOT NULL DEFAULT 0,
	cached_tokens INTEGER NOT NULL DEFAULT 0,
	cache_read_tokens INTEGER NOT NULL DEFAULT 0,
	cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
	total_tokens INTEGER NOT NULL DEFAULT 0,
	token_breakdown_zst BLOB,
	request_headers_zst BLOB,
	response_headers_zst BLOB,
	error_body_zst BLOB,
	request_preview_zst BLOB,
	response_preview_zst BLOB
);
CREATE INDEX IF NOT EXISTS idx_request_logs_requested_at ON request_logs (requested_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs (model);
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key ON request_logs (api_key);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs (provider);
CREATE INDEX IF NOT EXISTS idx_request_logs_session ON request_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_request_id ON request_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_failed ON request_logs (failed, requested_at);
`

// migrate brings the database up to currentSchemaVersion. Version 0 (fresh
// file) applies the full v1 DDL; later revisions append incremental steps.
func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("requestdb: create schema_version table: %w", err)
	}
	var version int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&version); err != nil {
		return fmt.Errorf("requestdb: read schema version: %w", err)
	}
	if version > currentSchemaVersion {
		return fmt.Errorf("requestdb: schema version %d is newer than supported version %d", version, currentSchemaVersion)
	}
	if version < 1 {
		if _, err := db.Exec(schemaV1); err != nil {
			return fmt.Errorf("requestdb: apply schema v1: %w", err)
		}
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (1)`); err != nil {
			return fmt.Errorf("requestdb: record schema v1: %w", err)
		}
	}
	if version < 2 {
		if _, err := db.Exec(`
			UPDATE request_logs
			SET total_tokens = CASE
				WHEN total_tokens < (input_tokens + cache_read_tokens + cache_creation_tokens + output_tokens)
				THEN (input_tokens + cache_read_tokens + cache_creation_tokens + output_tokens)
				ELSE total_tokens END,
				input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens
			WHERE (provider LIKE '%claude%' OR provider LIKE '%anthropic%' OR executor_type LIKE '%claude%' OR input_tokens < cache_read_tokens)
			  AND (cache_read_tokens > 0 OR cache_creation_tokens > 0)
			  AND input_tokens < (cache_read_tokens + cache_creation_tokens);
		`); err != nil {
			return fmt.Errorf("requestdb: apply schema v2: %w", err)
		}
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (2)`); err != nil {
			return fmt.Errorf("requestdb: record schema v2: %w", err)
		}
	}
	if version < 3 {
		exists, errCol := tableHasColumn(db, "request_logs", "provider_name")
		if errCol != nil {
			return fmt.Errorf("requestdb: inspect request_logs columns: %w", errCol)
		}
		if !exists {
			if _, err := db.Exec(`ALTER TABLE request_logs ADD COLUMN provider_name TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("requestdb: apply schema v3: %w", err)
			}
		}
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (3)`); err != nil {
			return fmt.Errorf("requestdb: record schema v3: %w", err)
		}
	}
	return nil
}

func tableHasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer func() {
		_ = rows.Close()
	}()
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue sql.NullString
		var pk int
		if errScan := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); errScan != nil {
			return false, errScan
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
