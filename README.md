# Mutual Data Graph Viewer

A standalone web app for analyzing Discord mutual-data exports through a weighted server graph, server insights, and user rankings.

## Example

![Example server relationship graph](docs/sample-graph.jpg)

Example visualization generated from an imported mutual-data set.

## Features

- Imports Discord server/member export data using the `servers[].members[]` structure
- Derives server-to-server overlap in a Web Worker
- Renders the network with Sigma.js and Graphology
- Includes:
  - Interactive graph view
  - Server connectivity table
  - User ranking view
  - Edge-pair inspector showing users shared between two servers
  - Separation-weighted ranking for finding users who span distinct server communities

## Input format

The app expects JSON in the following general structure:

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

Install dependencies and start the Vite development server:

```bash
npm install
npm run dev
```

By default, the app is available at `http://localhost:5173`.

## Optional mirrored-worktree workflow

The repository includes scripts for developing from a local cache/worktree while keeping another copy synchronized. This can be useful when the primary project directory is on a synced, networked, or removable drive where `node_modules` is slow or unreliable.

Available commands:

```bash
npm run dev:drive-mirror
npm run sync:to:cache
npm run sync:to:drive
```

The exact source and cache paths are defined by the accompanying PowerShell scripts and may need to be adjusted for another environment.

## Tests

Run the test suite with:

```bash
npm run test
npm run e2e
```

The E2E tests expect a sample export path in `MUTUAL_SAMPLE_JSON`:

```bash
set MUTUAL_SAMPLE_JSON=C:\path\to\mutual-server-members.json
npm run e2e
```

## Cloudflare Pages + D1

The project is configured for Cloudflare Pages Functions with D1.

### 1. Create a D1 database

```bash
wrangler d1 create mutual_graph_db
```

Copy the returned database IDs into `wrangler.toml` as `database_id` and `preview_database_id`.

### 2. Apply migrations

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

### 3. Deploy

```bash
npm run cf:deploy
```

### API functions

- `GET /api/health` confirms that the D1 binding is working
- `GET /api/snapshots` returns recent saved analysis snapshots
- `POST /api/snapshots` stores the current summary and top rankings in D1

## Separation score

In **User Ranking**, switch to **Diverse Mutuals** to rank users by how broadly they span otherwise distinct groups of servers.

For each user:

- `mutualServerCount` is the number of servers in which the user appears
- `separationScore` is the average pairwise separation between those servers
- Pairwise separation is `1 - overlapCoefficient`
- The overlap coefficient is `sharedUsers / min(serverSizeA, serverSizeB)`
- `interestingScore = mutualServerCount * separationScore`

This reduces the ranking of users who appear mainly across highly similar server clusters and raises users who connect more distinct communities.

## Importing from an extension or content script

External browser code can pass an export into the app with:

```js
window.postMessage({ type: "mutual-graph:import-v1", payload: rawExportV1 }, "*");
```

## Included Discord scraper

The repository includes `discord-member-export.js`, which can be run from Discord web DevTools to generate an import file for the viewer.
