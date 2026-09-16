import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ImportControls } from "./features/import/ImportControls";
import { useImportWorker } from "./features/import/useImportWorker";
import { ControlsPanel } from "./components/ControlsPanel";
import { useGraphStore } from "./state/useGraphStore";
import { filterEdgesByThreshold, findFirstServerMatch } from "./state/selectors";
import { getDerivedGraphForBotMode } from "./domain/derive";
import { getServerDisplayName } from "./domain/display";
import type { DerivedGraphResult } from "./domain/types";
import { ServerGraphView } from "./features/graph/ServerGraphView";
import { SummaryBar } from "./features/dashboard/SummaryBar";
import { ServerTableView } from "./features/server-table/ServerTableView";
import { UserRankingView } from "./features/user-ranking/UserRankingView";
import { InspectorPanel } from "./features/inspector/InspectorPanel";

const saveSnapshotToD1 = async (data: NonNullable<ReturnType<typeof useGraphStore.getState>["data"]>) => {
  const body = {
    exportedAt: data.meta.exportedAt,
    source: data.meta.source,
    totals: data.insights.global.totals,
    topServers: data.insights.global.topServers,
    topUsers: data.insights.global.topUsers,
    mostConnectedServer: data.insights.global.mostConnectedServer,
    mostConnectedUser: data.insights.global.mostConnectedUser,
    densestCluster: data.insights.global.densestCluster,
    issues: data.meta.issues
  };

  const response = await fetch("/api/snapshots", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to save snapshot.");
  }
};

function App() {
  const { importFromFile, importFromJsonText } = useImportWorker();

  const status = useGraphStore((state) => state.status);
  const data = useGraphStore((state) => state.data);
  const view = useGraphStore((state) => state.view);
  const minSharedCount = useGraphStore((state) => state.minSharedCount);
  const excludeBots = useGraphStore((state) => state.excludeBots);
  const searchTerm = useGraphStore((state) => state.searchTerm);
  const setView = useGraphStore((state) => state.setView);
  const selectServer = useGraphStore((state) => state.selectServer);
  const selectEdge = useGraphStore((state) => state.selectEdge);
  const [effectiveData, setEffectiveData] = useState<DerivedGraphResult | null>(null);
  const [isBusyRecomputing, setIsBusyRecomputing] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    if (!data) {
      setEffectiveData(null);
      setIsBusyRecomputing(false);
      return;
    }

    let cancelled = false;
    setIsBusyRecomputing(true);
    const timer = window.setTimeout(() => {
      const next = getDerivedGraphForBotMode(data, excludeBots);
      if (cancelled) return;
      setEffectiveData(next);
      setIsBusyRecomputing(false);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data, excludeBots]);

  const maxSharedCount = useMemo(() => {
    if (!effectiveData) return 2;
    return effectiveData.graph.serverEdges.reduce((max, edge) => Math.max(max, edge.sharedUserCount), 2);
  }, [effectiveData]);

  const serverSearchOptions = useMemo(() => {
    if (!effectiveData) return [];
    return effectiveData.graph.serverNodes.map((node) => ({
      id: node.id,
      name: node.name,
      displayName: getServerDisplayName(node.name, true)
    }));
  }, [effectiveData]);

  const visibleEdgeCount = useMemo(() => {
    if (!effectiveData) return 0;
    return filterEdgesByThreshold(effectiveData, minSharedCount).length;
  }, [effectiveData, minSharedCount]);

  const showBusyBar = status === "deriving" || (status === "ready" && isBusyRecomputing);
  const detailView = view === "users" ? "users" : "servers";

  useEffect(() => {
    if (!effectiveData) return;
    if (!deferredSearchTerm.trim()) return;
    const match = findFirstServerMatch(effectiveData.graph.serverNodes, deferredSearchTerm);
    if (!match) return;
    selectServer(match.id);
  }, [deferredSearchTerm, effectiveData, selectServer]);

  useEffect(() => {
    (window as Window & {
      __mutualGraphDebug?: {
        selectEdge: (sourceServerId: string, targetServerId: string) => void;
        selectFirstEdge: () => void;
      };
    }).__mutualGraphDebug = {
      selectEdge: (sourceServerId: string, targetServerId: string) => {
        selectEdge({ sourceServerId, targetServerId });
      },
      selectFirstEdge: () => {
        const firstEdge = effectiveData?.graph.serverEdges[0];
        if (!firstEdge) return;
        selectEdge({
          sourceServerId: firstEdge.sourceServerId,
          targetServerId: firstEdge.targetServerId
        });
      }
    };
  }, [effectiveData, selectEdge]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Mutual Data Graph Viewer</h1>
        <p>
          Viewer for Discord mutual graphs. Insights are based on collected data.
        </p>
      </header>

      <main className="app-main">
        <aside className="left-column">
          <ImportControls onImportFile={importFromFile} onImportJsonText={importFromJsonText} />
          <ControlsPanel maxSharedCount={maxSharedCount} serverSearchOptions={serverSearchOptions} />
        </aside>

        <section className="center-column">
          {showBusyBar ? (
            <section className="panel busy-panel">
              <div className="busy-panel-header">
                <strong>{status === "deriving" ? "Deriving graph data..." : "Applying filter and recalculating..."}</strong>
                <span className="muted tiny">{status === "deriving" ? "Import compute running in worker" : "Refreshing insights and rankings"}</span>
              </div>
              <div className="progress-track" role="progressbar" aria-label="Loading">
                <div className="progress-indeterminate" />
              </div>
            </section>
          ) : null}

          {status === "idle" ? (
            <section className="panel empty-state">
              <h2>Start by importing JSON</h2>
              <p>Use your `mutual-server-members.json` export file to build the server overlap graph.</p>
              <p className="muted">
                {"You can also send data via window.postMessage({ type: \"mutual-graph:import-v1\", payload }, \"*\")."}
              </p>
            </section>
          ) : null}

          {status === "deriving" ? (
            <section className="panel empty-state">
              <h2>Deriving graph in worker...</h2>
              <p>Computing indices, server edges, and rankings.</p>
            </section>
          ) : null}

          {status === "ready" && effectiveData ? (
            <>
              <SummaryBar
                data={effectiveData}
                visibleEdgeCount={visibleEdgeCount}
                onSaveSnapshot={typeof fetch === "function" ? () => saveSnapshotToD1(effectiveData) : undefined}
              />

              {effectiveData.meta.issues.length > 0 ? (
                <section className="panel issues-panel">
                  <h2>Import Notes</h2>
                  <ul>
                    {effectiveData.meta.issues.map((issue, index) => (
                      <li key={`${issue}-${index}`}>{issue}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <ServerGraphView data={effectiveData} />

              <section className="panel mode-switch-panel">
                <div className="mode-switch-grid">
                  <button type="button" className={detailView === "servers" ? "active" : "ghost"} onClick={() => setView("servers")}>
                    Server Table
                  </button>
                  <button type="button" className={detailView === "users" ? "active" : "ghost"} onClick={() => setView("users")}>
                    User Ranking
                  </button>
                </div>
              </section>

              {detailView === "servers" ? <ServerTableView data={effectiveData} /> : null}
              {detailView === "users" ? <UserRankingView data={effectiveData} /> : null}
            </>
          ) : null}
        </section>

        <aside className="right-column">{status === "ready" && effectiveData ? <InspectorPanel data={effectiveData} /> : null}</aside>
      </main>
    </div>
  );
}

export default App;
