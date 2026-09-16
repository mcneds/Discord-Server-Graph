-- Run with: wrangler d1 migrations apply MUTUAL_GRAPH_DB --local

CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  exported_at TEXT,
  source TEXT,
  totals_json TEXT NOT NULL,
  top_servers_json TEXT NOT NULL,
  top_users_json TEXT NOT NULL,
  most_connected_server_json TEXT,
  most_connected_user_json TEXT,
  densest_cluster_json TEXT,
  issues_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_created_at ON analysis_snapshots(created_at DESC);
