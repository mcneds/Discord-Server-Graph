import { Fragment, useEffect, useState } from "react";
import type { DerivedGraphResult } from "../../domain/types";
import { getCachedUserRankingRows, type UserRankingRow } from "../../domain/viewCache";
import { useGraphStore } from "../../state/useGraphStore";

type UserRankingViewProps = {
  data: DerivedGraphResult;
};

export const UserRankingView = ({ data }: UserRankingViewProps) => {
  const [rankMode, setRankMode] = useState<"mutual" | "diverse">("mutual");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<UserRankingRow[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(true);
  const searchTerm = useGraphStore((state) => state.searchTerm);
  const excludeBots = useGraphStore((state) => state.excludeBots);
  const inspectorListLimit = useGraphStore((state) => state.inspectorListLimit);
  const selectedServerId = useGraphStore((state) => state.selectedServerId);
  const selectServer = useGraphStore((state) => state.selectServer);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingRows(true);
    const timer = window.setTimeout(() => {
      const nextRows = getCachedUserRankingRows(data, rankMode, excludeBots, searchTerm);
      if (cancelled) return;
      setRows(nextRows);
      setIsLoadingRows(false);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data, rankMode, excludeBots, searchTerm]);

  return (
    <section className="panel">
      <h2>User Ranking</h2>
      <p className="muted">Rank by raw mutual count, or by bridge-aware scoring across separated server islands.</p>
      <div className="row gap-sm rank-mode-row">
        <button type="button" className={rankMode === "mutual" ? "active" : "ghost"} onClick={() => setRankMode("mutual")}>
          Mutual Count
        </button>
        <button type="button" className={rankMode === "diverse" ? "active" : "ghost"} onClick={() => setRankMode("diverse")}>
          Diverse Mutuals
        </button>
      </div>

      {isLoadingRows ? (
        <div className="inline-loading-block">
          <div className="muted tiny">Computing ranking...</div>
          <div className="progress-track compact" role="progressbar" aria-label="Computing ranking">
            <div className="progress-indeterminate" />
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Mutual Server Count</th>
              <th>Separation Score</th>
              <th>Bridge Score</th>
              <th>Type</th>
              <th>Example Servers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, serverPreview, servers }) => {
              const isExpanded = expandedUserId === user.id;
              const visibleServers = servers.slice(0, Math.max(8, inspectorListLimit * 3));
              const hiddenCount = Math.max(0, servers.length - visibleServers.length);

              return (
                <Fragment key={user.id}>
                  <tr
                    className={`user-rank-row ${isExpanded ? "expanded" : ""}`}
                    onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                  >
                    <td>
                      <div className="table-primary">{user.displayName ?? user.username ?? user.id}</div>
                      <div className="table-secondary">{user.id}</div>
                    </td>
                    <td>{user.mutualServerCount.toLocaleString()}</td>
                    <td>{user.separationScore.toFixed(3)}</td>
                    <td>{(user.bridgeScore ?? user.interestingScore).toFixed(2)}</td>
                    <td>{user.isBot ? "Bot" : "User"}</td>
                    <td>{serverPreview.join(", ") || "-"}</td>
                  </tr>

                  {isExpanded ? (
                    <tr className="user-rank-detail-row">
                      <td colSpan={6}>
                        <div className="user-rank-detail">
                          <div className="user-rank-detail-header">
                            <strong>Servers ({servers.length})</strong>
                            <span className="muted tiny">Click a server to open its insights</span>
                          </div>

                          <div className="user-server-list user-rank-server-list">
                            {visibleServers.length === 0 ? <div className="muted tiny">No servers.</div> : null}
                            {visibleServers.map((server) => (
                              <button
                                key={`${user.id}-${server.id}`}
                                type="button"
                                className={`user-server-item ${selectedServerId === server.id ? "active" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectServer(server.id);
                                }}
                              >
                                <span>{server.name}</span>
                                <small>{server.id}</small>
                              </button>
                            ))}
                          </div>

                          {hiddenCount > 0 ? <div className="muted tiny">+{hiddenCount} more not shown</div> : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
