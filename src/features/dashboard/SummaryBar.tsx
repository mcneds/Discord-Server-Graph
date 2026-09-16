import { useMemo, useState } from "react";
import type { DerivedGraphResult } from "../../domain/types";
import { useGraphStore } from "../../state/useGraphStore";

type SummaryBarProps = {
  data: DerivedGraphResult;
  visibleEdgeCount: number;
  onSaveSnapshot?: () => Promise<void>;
};

export const SummaryBar = ({ data, visibleEdgeCount, onSaveSnapshot }: SummaryBarProps) => {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const excludeBots = useGraphStore((state) => state.excludeBots);

  const global = data.insights.global;

  const topUser = useMemo(() => {
    if (!excludeBots) return global.mostConnectedUser;
    return global.topUsers.find((user) => !user.isBot) ?? null;
  }, [excludeBots, global]);

  const handleSave = async () => {
    if (!onSaveSnapshot) return;
    try {
      setSaveState("saving");
      await onSaveSnapshot();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
    }
  };

  return (
    <section className="summary-bar panel">
      <div className="summary-grid">
        <div>
          <div className="summary-label">Servers</div>
          <div className="summary-value">{global.totals.servers.toLocaleString()}</div>
        </div>
        <div>
          <div className="summary-label">Unique Users</div>
          <div className="summary-value">{global.totals.uniqueUsers.toLocaleString()}</div>
        </div>
        <div>
          <div className="summary-label">Edges (all)</div>
          <div className="summary-value">{global.totals.serverEdges.toLocaleString()}</div>
        </div>
        <div>
          <div className="summary-label">Edges (visible)</div>
          <div className="summary-value" data-testid="visible-edge-count">
            {visibleEdgeCount.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="summary-label">Top User</div>
          <div className="summary-value small">
            {topUser ? `${topUser.displayName ?? topUser.username ?? topUser.id} (${topUser.mutualServerCount})` : "-"}
          </div>
        </div>
        <div>
          <div className="summary-label">Densest Cluster</div>
          <div className="summary-value small">
            {global.densestCluster ? `${global.densestCluster.nodeCount} servers @ ${(global.densestCluster.density * 100).toFixed(1)}%` : "-"}
          </div>
        </div>
      </div>
      {onSaveSnapshot ? (
        <div className="row gap-sm">
          <button type="button" className="ghost" onClick={handleSave} disabled={saveState === "saving"}>
            Save Summary to D1
          </button>
          <span className="muted">
            {saveState === "saving" ? "Saving..." : null}
            {saveState === "saved" ? "Saved." : null}
            {saveState === "error" ? "Save failed." : null}
          </span>
        </div>
      ) : null}
    </section>
  );
};
