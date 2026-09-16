import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import random from "graphology-layout/random";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import type { DerivedGraphResult, ServerEdge, ServerNode } from "../../domain/types";
import { getEdgeKey } from "../../domain/derive";
import { getServerDisplayName } from "../../domain/display";
import { filterEdgesByThreshold } from "../../state/selectors";
import { useGraphStore } from "../../state/useGraphStore";

type ServerGraphViewProps = {
  data: DerivedGraphResult;
};

type IslandSummary = {
  componentId: number;
  nodeCount: number;
  edgeCount: number;
  color: string;
};

const ISLAND_PALETTE = ["#2563eb", "#0d9488", "#ea580c", "#9333ea", "#0891b2", "#ca8a04", "#e11d48", "#16a34a"];
const DISCONNECTED_NODE_COLOR = "#94a3b8";
const GRAPH_DEFAULT_HEIGHT = 560;
const GRAPH_MIN_HEIGHT = 320;

const edgeColor = (weight: number): string => {
  const alpha = Math.max(0.1, Math.min(0.86, Math.log1p(weight) / 6));
  return `rgba(15, 23, 42, ${alpha.toFixed(2)})`;
};

const edgeSize = (weight: number): number => Math.max(0.4, Math.min(4.2, Math.log1p(weight) * 0.8));

const integralNodeSize = (score: number, maxScore: number, degree: number): number => {
  if (degree <= 0) return 1.6;
  if (maxScore <= 0) return 2.8;
  const normalized = Math.max(0, Math.min(1, score / maxScore));
  return 2 + Math.pow(normalized, 0.68) * 7.5;
};

const withScaledAlpha = (color: string, alphaScale: number): string => {
  const text = String(color || "").trim();
  const rgba = text.match(/^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const a = Number(rgba[4]);
    const nextAlpha = Math.max(0.06, Math.min(1, a * alphaScale));
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha.toFixed(3)})`;
  }
  const rgb = text.match(/^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const nextAlpha = Math.max(0.06, Math.min(1, 0.55 * alphaScale));
    return `rgba(${r}, ${g}, ${b}, ${nextAlpha.toFixed(3)})`;
  }
  return text || "rgba(15, 23, 42, 0.24)";
};

const computeIslands = (nodes: ServerNode[], edges: ServerEdge[]) => {
  const degreeByNode = new Map<string, number>();
  for (const node of nodes) degreeByNode.set(node.id, 0);
  for (const edge of edges) {
    degreeByNode.set(edge.sourceServerId, (degreeByNode.get(edge.sourceServerId) ?? 0) + 1);
    degreeByNode.set(edge.targetServerId, (degreeByNode.get(edge.targetServerId) ?? 0) + 1);
  }

  const activeNodeIds = nodes.map((node) => node.id).filter((id) => (degreeByNode.get(id) ?? 0) > 0);
  const componentByNode = new Map<string, number>();

  if (activeNodeIds.length === 0) {
    return {
      componentByNode,
      summary: [] as IslandSummary[]
    };
  }

  const adjacency = new Map<string, string[]>();
  const rawComponentByNode = new Map<string, number>();
  for (const nodeId of activeNodeIds) adjacency.set(nodeId, []);

  for (const edge of edges) {
    if (!adjacency.has(edge.sourceServerId) || !adjacency.has(edge.targetServerId)) continue;
    adjacency.get(edge.sourceServerId)?.push(edge.targetServerId);
    adjacency.get(edge.targetServerId)?.push(edge.sourceServerId);
  }

  const components: Array<{ rawId: number; nodes: string[]; edgeCount: number }> = [];
  const visited = new Set<string>();
  let rawId = 0;

  for (const nodeId of activeNodeIds) {
    if (visited.has(nodeId)) continue;

    const queue = [nodeId];
    const componentNodes: string[] = [];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      componentNodes.push(current);
      rawComponentByNode.set(current, rawId);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push({ rawId, nodes: componentNodes, edgeCount: 0 });
    rawId += 1;
  }

  for (const edge of edges) {
    const sourceComp = rawComponentByNode.get(edge.sourceServerId);
    const targetComp = rawComponentByNode.get(edge.targetServerId);
    if (sourceComp !== undefined && sourceComp === targetComp) {
      components[sourceComp].edgeCount += 1;
    }
  }

  const sorted = [...components].sort((a, b) => {
    if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length;
    return b.edgeCount - a.edgeCount;
  });

  const rankedComponentByRaw = new Map<number, number>();
  sorted.forEach((component, rank) => rankedComponentByRaw.set(component.rawId, rank));

  for (const [nodeId, original] of rawComponentByNode.entries()) {
    const rank = rankedComponentByRaw.get(original) ?? 0;
    componentByNode.set(nodeId, rank);
  }

  const summary: IslandSummary[] = sorted
    .filter((component) => component.nodes.length >= 2 && component.edgeCount > 0)
    .map((component, rank) => ({
      componentId: rank,
      nodeCount: component.nodes.length,
      edgeCount: component.edgeCount,
      color: ISLAND_PALETTE[rank % ISLAND_PALETTE.length]
    }));

  return {
    componentByNode,
    summary
  };
};

const buildGraph = (nodes: ServerNode[], edges: ServerEdge[]) => {
  const graph = new Graph();
  const { componentByNode, summary } = computeIslands(nodes, edges);

  const degreeByNode = new Map<string, number>();
  const weightedByNode = new Map<string, number>();

  for (const node of nodes) {
    degreeByNode.set(node.id, 0);
    weightedByNode.set(node.id, 0);
  }

  for (const edge of edges) {
    degreeByNode.set(edge.sourceServerId, (degreeByNode.get(edge.sourceServerId) ?? 0) + 1);
    degreeByNode.set(edge.targetServerId, (degreeByNode.get(edge.targetServerId) ?? 0) + 1);
    weightedByNode.set(edge.sourceServerId, (weightedByNode.get(edge.sourceServerId) ?? 0) + edge.sharedUserCount);
    weightedByNode.set(edge.targetServerId, (weightedByNode.get(edge.targetServerId) ?? 0) + edge.sharedUserCount);
  }

  const integralByNode = new Map<string, number>();
  let maxIntegral = 0;
  for (const node of nodes) {
    const degree = degreeByNode.get(node.id) ?? 0;
    const weighted = weightedByNode.get(node.id) ?? 0;
    const integral = degree <= 0 ? 0 : Math.log1p(weighted) * Math.log2(degree + 1);
    integralByNode.set(node.id, integral);
    if (integral > maxIntegral) maxIntegral = integral;
  }

  for (const node of nodes) {
    const componentId = componentByNode.get(node.id);
    const baseColor = componentId === undefined ? DISCONNECTED_NODE_COLOR : ISLAND_PALETTE[componentId % ISLAND_PALETTE.length];
    const degree = degreeByNode.get(node.id) ?? 0;
    const integral = integralByNode.get(node.id) ?? 0;
    graph.addNode(node.id, {
      label: getServerDisplayName(node.name, true),
      rawLabel: node.name,
      size: integralNodeSize(integral, maxIntegral, degree),
      color: baseColor,
      baseColor,
      componentId: componentId ?? null,
      integralScore: integral,
      degree
    });
  }

  for (const edge of edges) {
    const key = getEdgeKey(edge.sourceServerId, edge.targetServerId);
    if (!graph.hasNode(edge.sourceServerId) || !graph.hasNode(edge.targetServerId)) continue;
    graph.addEdgeWithKey(key, edge.sourceServerId, edge.targetServerId, {
      label: String(edge.sharedUserCount),
      size: edgeSize(edge.sharedUserCount),
      color: edgeColor(edge.sharedUserCount)
    });
  }

  if (graph.order > 0) {
    random.assign(graph);
    forceAtlas2.assign(graph, {
      iterations: 120,
      settings: forceAtlas2.inferSettings(graph)
    });
  }

  return {
    graph,
    summary
  };
};

const nodeColorWithFocus = (
  nodeId: string,
  nodeLabel: string,
  rawLabel: string,
  baseColor: string,
  selectedServerId: string | null,
  searchTerm: string
): string => {
  if (selectedServerId === nodeId) return "#0d9488";
  const term = searchTerm.trim().toLowerCase();
  if (term && (`${nodeLabel} ${rawLabel}`.toLowerCase().includes(term) || nodeId.toLowerCase().includes(term))) return "#ea580c";
  return baseColor;
};

export const ServerGraphView = ({ data }: ServerGraphViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const selectedServerIdRef = useRef<string | null>(null);
  const searchTermRef = useRef<string>("");
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [graphInitError, setGraphInitError] = useState<string | null>(null);
  const [islandSummary, setIslandSummary] = useState<IslandSummary[]>([]);
  const [graphHeight, setGraphHeight] = useState<number>(GRAPH_DEFAULT_HEIGHT);
  const [isResizingGraph, setIsResizingGraph] = useState(false);

  const minSharedCount = useGraphStore((state) => state.minSharedCount);
  const searchTerm = useGraphStore((state) => state.searchTerm);
  const selectedServerId = useGraphStore((state) => state.selectedServerId);
  const selectedEdge = useGraphStore((state) => state.selectedEdge);
  const selectServer = useGraphStore((state) => state.selectServer);
  const selectEdge = useGraphStore((state) => state.selectEdge);

  const filteredEdges = useMemo(() => filterEdgesByThreshold(data, minSharedCount), [data, minSharedCount]);
  const hasSelection = Boolean(selectedServerId || selectedEdge);
  const expandedGraphHeight = useMemo(() => Math.max(GRAPH_DEFAULT_HEIGHT, Math.floor(window.innerHeight * 0.72)), []);
  const maxGraphHeight = useMemo(() => Math.max(expandedGraphHeight, Math.floor(window.innerHeight * 0.9)), [expandedGraphHeight]);
  const isExpanded = graphHeight >= expandedGraphHeight - 4;

  const clearSelection = () => {
    selectServer(null);
    requestAnimationFrame(() => safeRefresh());
  };

  const safeRefresh = () => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    try {
      sigma.resize();
      sigma.refresh();
    } catch {
      // Ignore transient renderer errors and let the next state change re-drive render.
    }
  };

  const clampGraphHeight = useCallback(
    (value: number) => Math.max(GRAPH_MIN_HEIGHT, Math.min(maxGraphHeight, Math.round(value))),
    [maxGraphHeight]
  );

  const toggleGraphExpand = () => {
    setGraphHeight((current) => (current >= expandedGraphHeight - 4 ? GRAPH_DEFAULT_HEIGHT : expandedGraphHeight));
  };

  const startGraphResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startY: event.clientY,
      startHeight: graphHeight
    };
    setIsResizingGraph(true);
  };

  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
    searchTermRef.current = searchTerm;
    requestAnimationFrame(() => safeRefresh());
  }, [searchTerm, selectedServerId]);

  useEffect(() => {
    requestAnimationFrame(() => safeRefresh());
  }, [graphHeight]);

  useEffect(() => {
    if (!isResizingGraph) return;

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = event.clientY - drag.startY;
      setGraphHeight(clampGraphHeight(drag.startHeight + delta));
    };

    const stopResize = () => {
      dragStateRef.current = null;
      setIsResizingGraph(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    document.body.classList.add("graph-resize-active");

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("graph-resize-active");
    };
  }, [clampGraphHeight, isResizingGraph]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      safeRefresh();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const { graph, summary } = buildGraph(data.graph.serverNodes, filteredEdges);
    const container = containerRef.current;

    const frame = requestAnimationFrame(() => {
      try {
        setGraphInitError(null);
        setIslandSummary(summary);

        const sigma = new Sigma(graph, container, {
          renderEdgeLabels: false,
          labelDensity: 0.04,
          labelGridCellSize: 140,
          defaultEdgeType: "line",
          zIndex: true,
          nodeReducer: (node, attributes) => {
            const label = String(attributes.label ?? node);
            const rawLabel = String(attributes.rawLabel ?? label);
            const baseColor = String(attributes.baseColor ?? "#1d4ed8");
            return {
              ...attributes,
              color: nodeColorWithFocus(node, label, rawLabel, baseColor, selectedServerIdRef.current, searchTermRef.current)
            };
          },
          edgeReducer: (edge, attributes) => {
            const selected = selectedServerIdRef.current;
            if (!selected) return attributes;

            const [source, target] = graph.extremities(edge);
            const touchesSelected = source === selected || target === selected;
            if (touchesSelected) {
              return {
                ...attributes,
                color: "rgba(13, 148, 136, 0.96)",
                size: Math.max(0.95, Number(attributes.size ?? 1) * 1.45),
                zIndex: 1
              };
            }

            return {
              ...attributes,
              color: withScaledAlpha(String(attributes.color ?? "rgba(15, 23, 42, 0.24)"), 0.65),
              size: Math.max(0.35, Number(attributes.size ?? 1) * 0.95),
              zIndex: 0
            };
          }
        });

        sigma.on("clickNode", ({ node }: { node: string }) => {
          selectServer(node);
          requestAnimationFrame(() => safeRefresh());
        });

        sigma.on("clickStage", () => {
          clearSelection();
        });

        sigma.on("clickEdge", ({ edge }: { edge: string }) => {
          const [sourceServerId, targetServerId] = edge.split("|");
          if (!sourceServerId || !targetServerId) return;
          selectEdge({ sourceServerId, targetServerId });
          requestAnimationFrame(() => safeRefresh());
        });

        sigmaRef.current = sigma;
        sigma.resize();
        sigma.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to initialize graph renderer.";
        setGraphInitError(message);
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      sigmaRef.current?.kill();
      sigmaRef.current = null;
    };
  }, [data.graph.serverNodes, filteredEdges, selectEdge, selectServer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearSelection();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section className="panel graph-panel">
      <div className="graph-header-row">
        <h2>Server Graph</h2>
        <div className="graph-header-actions">
          <button type="button" className="ghost graph-size-button" onClick={toggleGraphExpand}>
            {isExpanded ? "Reset graph size" : "Expand graph"}
          </button>
          <button
            type="button"
            className={hasSelection ? "ghost graph-clear-button" : "ghost graph-clear-button hidden"}
            onClick={clearSelection}
            disabled={!hasSelection}
          >
            Clear selection
          </button>
        </div>
      </div>
      <p className="muted">Node size reflects connection integral score; colors mark active threshold islands. Click empty space or press Esc to clear selection.</p>
      <div className="graph-container" ref={containerRef} style={{ height: `${graphHeight}px` }} />
      <button
        type="button"
        className={isResizingGraph ? "graph-resize-handle active" : "graph-resize-handle"}
        onPointerDown={startGraphResize}
        title="Drag to resize graph"
        aria-label="Drag to resize graph"
      >
        <span />
      </button>
      {graphInitError ? <p className="error">Graph render error: {graphInitError}</p> : null}
      {islandSummary.length > 1 ? (
        <div className="island-summary">
          <span className="muted">Islands detected at current threshold: {islandSummary.length}</span>
          <div className="island-badges">
            {islandSummary.slice(0, 8).map((island) => (
              <span key={island.componentId} className="island-badge" title={`${island.edgeCount} internal edges`}>
                <i style={{ backgroundColor: island.color }} />
                #{island.componentId + 1}: {island.nodeCount}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
