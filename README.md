# Mutual Data Graph Viewer

Standalone web app for analyzing Discord mutual data exports with a weighted server graph, server insights, and user rankings.

## What it does
- Imports your existing export format (`servers[].members[]`)
- Derives server-to-server overlap graph in a Web Worker
- Renders graph with Sigma.js + Graphology
- Provides:
  - Graph view
  - Server connectivity table
  - User ranking view
- Includes edge pair inspector (shared users between 2 servers)
- Includes a separation-weighted user ranking mode to surface users spanning distinct server concepts

## Input schema
Expected JSON:

```json
{
  "exported_at": "2026-03-06T21:42:44.851Z",
  "source": "discord-web-dom",
  "servers": [
    {
      "server_id": "123",
      "server_name": "Example",
      "server_icon_url": "https://...",
      "members": [
        {
          "user_id": "456",
          "username": "user",
          "display_name": "display",
          "is_bot": false,
          "user_icon_url": "https://..."
        }
      ]
    }
  ]
}
```

## Local development
```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Drive mirror workflow (recommended for your setup)
When `G:\My Drive\...` cannot reliably install `node_modules`, run dev from cache and sync files.

Paths used by scripts:
- Drive: `g:\My Drive\random bs\mutual graph`
- Cache: `c:\dev-cache\mutual-graph-worktree`

From either copy:

```bash
npm run dev:drive-mirror
```

What it does:
- initial sync `Drive -> Cache`
- starts Vite from cache (where dependencies work)
- keeps syncing `Drive -> Cache` while dev server runs
- on exit, final sync `Cache -> Drive`

Manual one-shot sync commands:

```bash
npm run sync:to:cache
npm run sync:to:drive
```

## Tests
```bash
npm run test
npm run e2e
```

E2E expects:
```bash
set MUTUAL_SAMPLE_JSON=C:\path\to\mutual-server-members.json
npm run e2e
```

## Cloudflare Pages + D1
This project is configured for Cloudflare Pages Functions with D1.

### 1. Create D1 database
```bash
wrangler d1 create mutual_graph_db
```

Copy the returned database IDs into `wrangler.toml` (`database_id`, `preview_database_id`).

### 2. Apply migrations
```bash
npm run db:migrate:local
npm run db:migrate:remote
```

### 3. Deploy
```bash
npm run cf:deploy
```

### Available Functions
- `GET /api/health` -> confirms D1 binding works
- `GET /api/snapshots` -> recent saved analysis snapshots
- `POST /api/snapshots` -> stores current summary/top rankings in D1

## Separation score (for interesting mutuals)
In **User Ranking**, switch to **Diverse Mutuals**.

Per user:
- `mutualServerCount`: number of servers they appear in
- `separationScore`: average pairwise separation between that user’s servers
- pairwise separation is `1 - overlapCoefficient`
- overlap coefficient uses `sharedUsers / min(serverSizeA, serverSizeB)`
- `interestingScore = mutualServerCount * separationScore`

This demotes users who are only in very similar clusters (for example many near-duplicate topic servers) and promotes users spanning more distinct server groups.

## Extension handoff hook
You can import from an extension/content script with:

```js
window.postMessage({ type: "mutual-graph:import-v1", payload: rawExportV1 }, "*");
```

## Existing scraper script
The repository still includes:
- `discord-member-export.js`

Use it in Discord web DevTools to generate the import file.
