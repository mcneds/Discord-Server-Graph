import { useMemo, useState } from "react";
import { getSharedUsersForEdge } from "../../domain/derive";
import { getServerDisplayName } from "../../domain/display";
import type { DerivedGraphResult, UserProfile } from "../../domain/types";
import { useGraphStore } from "../../state/useGraphStore";

type InspectorPanelProps = {
  data: DerivedGraphResult;
};

type ExpandableUserRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  mutualServerCount: number;
  isBot: boolean;
  bridgeScore?: number;
  bridgeConfidence?: number;
};

const getDisplayName = (user: UserProfile | ExpandableUserRow): string => user.displayName ?? user.username ?? user.id;

const averageHistogram = (histogram: Array<{ mutualServerCount: number; userCount: number }>): number => {
  const totals = histogram.reduce(
    (acc, bucket) => {
      acc.members += bucket.userCount;
      acc.weighted += bucket.mutualServerCount * bucket.userCount;
      return acc;
    },
    { members: 0, weighted: 0 }
  );
  if (totals.members === 0) return 0;
  return totals.weighted / totals.members;
};

export const InspectorPanel = ({ data }: InspectorPanelProps) => {
  const selectedServerId = useGraphStore((state) => state.selectedServerId);
  const selectedEdge = useGraphStore((state) => state.selectedEdge);
  const inspectorListLimit = useGraphStore((state) => state.inspectorListLimit);
  const setInspectorListLimit = useGraphStore((state) => state.setInspectorListLimit);
  const excludeBots = useGraphStore((state) => state.excludeBots);
  const selectServer = useGraphStore((state) => state.selectServer);

  const [expandedUserKey, setExpandedUserKey] = useState<string | null>(null);

  const selectedServerNode = selectedServerId
    ? data.graph.serverNodes.find((node) => node.id === selectedServerId) ?? null
    : null;

  const selectedServerInsight = selectedServerId ? data.insights.byServer[selectedServerId] ?? null : null;

  const topConnectedUser = useMemo(() => {
    if (!excludeBots) return data.insights.global.mostConnectedUser;
    return data.insights.global.topUsers.find((user) => !user.isBot) ?? null;
  }, [data, excludeBots]);

  const topUserInServer = useMemo(() => {
    if (!selectedServerId) return null;
    const users = (data.indices.serverToUsers[selectedServerId] ?? [])
      .map((userId) => data.indices.usersById[userId])
      .filter((user): user is UserProfile => Boolean(user))
      .filter((user) => (excludeBots ? !user.isBot : true))
      .sort((a, b) => {
        if (b.mutualServerCount !== a.mutualServerCount) return b.mutualServerCount - a.mutualServerCount;
        return getDisplayName(a).localeCompare(getDisplayName(b), undefined, { sensitivity: "base" });
      });
    return users[0] ?? null;
  }, [data, excludeBots, selectedServerId]);

  const sharedUsers = useMemo(() => {
    if (!selectedEdge) return [];
    const users = getSharedUsersForEdge(data, selectedEdge.sourceServerId, selectedEdge.targetServerId, 120);
    return excludeBots ? users.filter((user) => !user.isBot) : users;
  }, [data, excludeBots, selectedEdge]);

  const computedTopBridgeUsers = useMemo(() => {
    if (!selectedServerInsight) return [];
    return selectedServerInsight.topBridgeUsers
      .filter((user) => (excludeBots ? !user.isBot : true))
      .map((user) => ({
        id: user.userId,
        username: user.username,
        displayName: user.displayName,
        mutualServerCount: user.mutualServerCount,
        isBot: user.isBot,
        bridgeScore: user.bridgeScore,
        bridgeConfidence: user.confidence
      }));
  }, [excludeBots, selectedServerInsight]);

  const focusServer = (serverId: string) => {
    selectServer(serverId);
  };

  const renderSidebarRowsControl = () => (
    <div className="row gap-sm threshold-row inspector-limit-row">
      <label htmlFor="sidebar-row-count" className="field-label no-margin">
        Sidebar rows shown
      </label>
      <input
        id="sidebar-row-count"
        className="threshold-input"
        type="number"
        min={1}
        max={50}
        value={inspectorListLimit}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          setInspectorListLimit(parsed);
        }}
      />
    </div>
  );

  const renderExpandableUserRow = (sectionKey: string, user: ExpandableUserRow) => {
    const key = `${sectionKey}:${user.id}`;
    const expanded = expandedUserKey === key;
    const profile = data.indices.usersById[user.id];
    const serverIds = data.indices.userToServers[user.id] ?? [];
    const visibleServers = serverIds.slice(0, Math.max(8, inspectorListLimit * 3)).map((serverId) => {
      const rawName = data.indices.serversById[serverId]?.name ?? serverId;
      return {
        id: serverId,
        name: getServerDisplayName(rawName, true)
      };
    });
    const hiddenServerCount = Math.max(0, serverIds.length - visibleServers.length);

    return (
      <div key={key} className="list-row-group">
        <button type="button" className="list-row list-row-button" onClick={() => setExpandedUserKey(expanded ? null : key)}>
          <span className="table-primary">{getDisplayName(user)}</span>
          <small>{user.bridgeScore !== undefined ? `${user.bridgeScore.toFixed(2)} bridge` : `${user.mutualServerCount} mutual`}</small>
        </button>
        {expanded ? (
          <div className="user-expand-panel">
            <div className="user-expand-header">
              <div className="table-secondary">{user.id}</div>
              <span className={`user-type-pill ${profile?.isBot || user.isBot ? "bot" : "human"}`}>
                {profile?.isBot || user.isBot ? "Bot" : "User"}
              </span>
            </div>
            <div className="user-expand-grid">
              <div className="user-metric-chip">
                <span>Mutual</span>
                <strong>{profile?.mutualServerCount ?? user.mutualServerCount}</strong>
              </div>
              <div className="user-metric-chip">
                <span>Separation</span>
                <strong>{(profile?.separationScore ?? 0).toFixed(3)}</strong>
              </div>
              {user.bridgeScore !== undefined || profile?.bridgeScore !== undefined ? (
                <div className="user-metric-chip">
                  <span>Bridge</span>
                  <strong>{(user.bridgeScore ?? profile?.bridgeScore ?? profile?.interestingScore ?? 0).toFixed(2)}</strong>
                </div>
              ) : null}
              {user.bridgeConfidence !== undefined ? (
                <div className="user-metric-chip">
                  <span>Confidence</span>
                  <strong>{user.bridgeConfidence.toFixed(2)}</strong>
                </div>
              ) : null}
            </div>
            <div className="user-expand-servers">
              <strong>Servers ({serverIds.length} total)</strong>
              <div className="user-server-list">
                {visibleServers.length === 0 ? <div className="muted tiny">No servers.</div> : null}
                {visibleServers.map((server) => (
                  <button
                    type="button"
                    key={`${key}:${server.id}`}
                    className={`user-server-item ${selectedServerId === server.id ? "active" : ""}`}
                    onClick={() => focusServer(server.id)}
                  >
                    <span>{server.name}</span>
                    <small>{server.id}</small>
                  </button>
                ))}
              </div>
              {hiddenServerCount > 0 ? <div className="muted tiny">+{hiddenServerCount} more not shown</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  if (selectedEdge) {
    const sourceRaw = data.indices.serversById[selectedEdge.sourceServerId]?.name ?? selectedEdge.sourceServerId;
    const targetRaw = data.indices.serversById[selectedEdge.targetServerId]?.name ?? selectedEdge.targetServerId;
    const sourceName = getServerDisplayName(sourceRaw, true);
    const targetName = getServerDisplayName(targetRaw, true);

    const edge = data.graph.serverEdges.find(
      (candidate) =>
        (candidate.sourceServerId === selectedEdge.sourceServerId && candidate.targetServerId === selectedEdge.targetServerId) ||
        (candidate.sourceServerId === selectedEdge.targetServerId && candidate.targetServerId === selectedEdge.sourceServerId)
    );

    return (
      <aside className="panel inspector-panel">
        <h2>Pair Inspector</h2>
        <p className="muted">
          {sourceName} <strong>{"<->"}</strong> {targetName}
        </p>
        <div className="stat-list">
          <div>
            <span className="muted">Shared users</span>
            <strong>{edge?.sharedUserCount.toLocaleString() ?? "0"}</strong>
          </div>
          <div>
            <span className="muted">Shown in list</span>
            <strong>{sharedUsers.length.toLocaleString()}</strong>
          </div>
        </div>
        {renderSidebarRowsControl()}
        <div className="scroll-list inspector-users-list">
          {sharedUsers.slice(0, Math.max(10, inspectorListLimit * 4)).map((user) =>
            renderExpandableUserRow("shared", {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              mutualServerCount: user.mutualServerCount,
              isBot: user.isBot
            })
          )}
        </div>
      </aside>
    );
  }

  if (selectedServerNode && selectedServerInsight) {
    const strongestName = selectedServerInsight.strongestNeighborId
      ? getServerDisplayName(
          data.indices.serversById[selectedServerInsight.strongestNeighborId]?.name ?? selectedServerInsight.strongestNeighborId,
          true
        )
      : "-";

    const topNeighbors = selectedServerInsight.topNeighbors.slice(0, inspectorListLimit);
    const topBridgeUsers = computedTopBridgeUsers.slice(0, inspectorListLimit);

    return (
      <aside className="panel inspector-panel">
        <h2>Server Insights</h2>
        <h3>{getServerDisplayName(selectedServerNode.name, true)}</h3>
        <div className="table-secondary">{selectedServerNode.id}</div>
        <div className="stat-list">
          <div>
            <span className="muted">Collected users</span>
            <strong>{selectedServerNode.collectedUserCount.toLocaleString()}</strong>
          </div>
          <div>
            <span className="muted">Connected servers</span>
            <strong>{selectedServerNode.connectedServerCount.toLocaleString()}</strong>
          </div>
          <div>
            <span className="muted">Strongest connected server</span>
            <strong>{strongestName}</strong>
          </div>
          <div>
            <span className="muted">Strongest edge weight</span>
            <strong>{selectedServerInsight.strongestEdgeWeight.toLocaleString()}</strong>
          </div>
          <div>
            <span className="muted">Top user in this server</span>
            <strong>{topUserInServer ? `${getDisplayName(topUserInServer)} (${topUserInServer.mutualServerCount})` : "-"}</strong>
          </div>
          <div>
            <span className="muted">Average user mutual count</span>
            <strong>{averageHistogram(selectedServerInsight.mutualHistogram).toFixed(2)}</strong>
          </div>
        </div>

        {renderSidebarRowsControl()}
        <h4>Top {topNeighbors.length} Connected Servers</h4>
        <div className="scroll-list short">
          {topNeighbors.map((neighbor) => (
            <button
              type="button"
              className={`list-row list-row-button selectable-row ${selectedServerId === neighbor.serverId ? "selected" : ""}`}
              key={neighbor.serverId}
              onClick={() => focusServer(neighbor.serverId)}
            >
              <span>{getServerDisplayName(neighbor.serverName, true)}</span>
              <small>{neighbor.sharedUserCount} shared</small>
            </button>
          ))}
        </div>

        <h4>Top {topBridgeUsers.length} Bridge Users</h4>
        <div className="scroll-list short inspector-users-list">
          {topBridgeUsers.map((user) => renderExpandableUserRow("bridge", user))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel inspector-panel">
      <h2>Global Highlights</h2>
      <div className="stat-list">
        <div>
          <span className="muted">Top connected server</span>
          <strong>{data.insights.global.mostConnectedServer ? getServerDisplayName(data.insights.global.mostConnectedServer.name, true) : "-"}</strong>
        </div>
        <div>
          <span className="muted">Top connected user</span>
          <strong>{topConnectedUser ? `${topConnectedUser.displayName ?? topConnectedUser.username ?? topConnectedUser.id} (${topConnectedUser.mutualServerCount})` : "-"}</strong>
        </div>
        <div>
          <span className="muted">Densest cluster</span>
          <strong>
            {data.insights.global.densestCluster
              ? `${data.insights.global.densestCluster.nodeCount} servers at ${(data.insights.global.densestCluster.density * 100).toFixed(1)}% density`
              : "-"}
          </strong>
        </div>
      </div>
      {renderSidebarRowsControl()}
      <p className="muted">Select a server node or edge in graph view for deeper drilldown.</p>
    </aside>
  );
};
