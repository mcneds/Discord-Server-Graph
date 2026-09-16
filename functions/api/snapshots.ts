type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  run: () => Promise<{ success: boolean }>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

type Env = {
  DB?: D1Database;
};

type Context = {
  env: Env;
  request: Request;
};

type SnapshotPayload = {
  exportedAt?: string | null;
  source?: string | null;
  totals?: unknown;
  topServers?: unknown;
  topUsers?: unknown;
  mostConnectedServer?: unknown;
  mostConnectedUser?: unknown;
  densestCluster?: unknown;
  issues?: unknown;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });

const createId = (): string => {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && "randomUUID" in cryptoObj) {
    return cryptoObj.randomUUID();
  }
  return `snap_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
};

export const onRequestGet = async ({ env }: Context): Promise<Response> => {
  if (!env.DB) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  const query = env.DB.prepare(
    `SELECT
      id,
      created_at,
      exported_at,
      source,
      totals_json,
      top_servers_json,
      top_users_json,
      most_connected_server_json,
      most_connected_user_json,
      densest_cluster_json,
      issues_json
     FROM analysis_snapshots
     ORDER BY created_at DESC
     LIMIT 25`
  );

  const result = await query.all<{
    id: string;
    created_at: string;
    exported_at: string | null;
    source: string | null;
    totals_json: string;
    top_servers_json: string;
    top_users_json: string;
    most_connected_server_json: string | null;
    most_connected_user_json: string | null;
    densest_cluster_json: string | null;
    issues_json: string | null;
  }>();

  return json({
    ok: true,
    snapshots: result.results.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      exportedAt: row.exported_at,
      source: row.source,
      totals: JSON.parse(row.totals_json),
      topServers: JSON.parse(row.top_servers_json),
      topUsers: JSON.parse(row.top_users_json),
      mostConnectedServer: row.most_connected_server_json ? JSON.parse(row.most_connected_server_json) : null,
      mostConnectedUser: row.most_connected_user_json ? JSON.parse(row.most_connected_user_json) : null,
      densestCluster: row.densest_cluster_json ? JSON.parse(row.densest_cluster_json) : null,
      issues: row.issues_json ? JSON.parse(row.issues_json) : []
    }))
  });
};

export const onRequestPost = async ({ env, request }: Context): Promise<Response> => {
  if (!env.DB) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  let payload: SnapshotPayload;
  try {
    payload = (await request.json()) as SnapshotPayload;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  if (!payload || typeof payload !== "object") {
    return json({ ok: false, error: "Payload must be an object." }, 400);
  }

  if (!payload.totals || !payload.topServers || !payload.topUsers) {
    return json({ ok: false, error: "Payload must include totals, topServers, and topUsers." }, 400);
  }

  const id = createId();

  await env.DB
    .prepare(
      `INSERT INTO analysis_snapshots (
        id,
        exported_at,
        source,
        totals_json,
        top_servers_json,
        top_users_json,
        most_connected_server_json,
        most_connected_user_json,
        densest_cluster_json,
        issues_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      payload.exportedAt ?? null,
      payload.source ?? null,
      JSON.stringify(payload.totals),
      JSON.stringify(payload.topServers),
      JSON.stringify(payload.topUsers),
      JSON.stringify(payload.mostConnectedServer ?? null),
      JSON.stringify(payload.mostConnectedUser ?? null),
      JSON.stringify(payload.densestCluster ?? null),
      JSON.stringify(payload.issues ?? [])
    )
    .run();

  return json({ ok: true, id }, 201);
};
