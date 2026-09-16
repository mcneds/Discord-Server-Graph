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
};

export const onRequestGet = async ({ env }: Context): Promise<Response> => {
  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: "Missing D1 binding: DB" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const row = await env.DB.prepare("SELECT datetime('now') AS now").all<{ now: string }>();
  return new Response(
    JSON.stringify({ ok: true, now: row.results[0]?.now ?? null }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
};
