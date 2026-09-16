import { describe, expect, it } from "vitest";
import { deriveGraphFromRaw, getSharedUsersForEdge } from "../../src/domain/derive";
import type { RawExportV1 } from "../../src/domain/types";

const fixture: RawExportV1 = {
  exported_at: "2026-03-07T00:00:00.000Z",
  source: "test",
  servers: [
    {
      server_id: "A",
      server_name: "Alpha",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u1", username: "u1" },
        { user_id: "u2", username: "u2" },
        { user_id: "u3", username: "u3" },
        { user_id: "", username: "bad" }
      ]
    },
    {
      server_id: "B",
      server_name: "Beta",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u2", username: "u2" },
        { user_id: "u4", username: "u4" }
      ]
    },
    {
      server_id: "C",
      server_name: "Gamma",
      members: [
        { user_id: "u1", username: "u1" },
        { user_id: "u5", username: "u5" }
      ]
    },
    {
      server_name: "Missing id",
      members: [{ user_id: "u9", username: "u9" }]
    }
  ]
};

describe("deriveGraphFromRaw", () => {
  it("normalizes rows, deduplicates memberships, and drops malformed rows", () => {
    const result = deriveGraphFromRaw(fixture);

    expect(result.indices.dedupedMembershipRows).toBe(1);
    expect(result.indices.droppedMembershipRows).toBe(1);
    expect(Object.keys(result.indices.serversById)).toEqual(["A", "B", "C"]);
    expect(result.indices.memberships).toHaveLength(8);
  });

  it("derives pairwise server edges and per-server strongest neighbors", () => {
    const result = deriveGraphFromRaw(fixture);

    expect(result.graph.serverEdges).toEqual([
      { sourceServerId: "A", targetServerId: "B", sharedUserCount: 2 },
      { sourceServerId: "A", targetServerId: "C", sharedUserCount: 1 },
      { sourceServerId: "B", targetServerId: "C", sharedUserCount: 1 }
    ]);

    expect(result.insights.byServer.A.strongestNeighborId).toBe("B");
    expect(result.insights.byServer.A.strongestEdgeWeight).toBe(2);
    expect(result.insights.byServer.A.topNeighbors[0]).toEqual({
      serverId: "B",
      serverName: "Beta",
      sharedUserCount: 2
    });
  });

  it("computes separation and interesting scores to favor cross-concept mutuals", () => {
    const result = deriveGraphFromRaw(fixture);

    const u1 = result.indices.usersById.u1;
    const u2 = result.indices.usersById.u2;

    expect(u1.mutualServerCount).toBe(3);
    expect(u1.separationScore).toBeCloseTo(0.4444, 3);
    expect(u1.interestingScore).toBeCloseTo(1.3333, 3);

    expect(u2.mutualServerCount).toBe(2);
    expect(u2.separationScore).toBeCloseTo(0.3333, 3);
    expect(u2.interestingScore).toBeCloseTo(0.6667, 3);
  });

  it("returns shared users for an inspected edge sorted by mutual server count", () => {
    const result = deriveGraphFromRaw(fixture);
    const users = getSharedUsersForEdge(result, "A", "B", 20);

    expect(users.map((user) => user.id)).toEqual(["u1", "u2"]);
  });
});
