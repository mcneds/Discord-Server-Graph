import type { DerivedGraphResult, ServerEdge, ServerNode } from "../domain/types";
import { getServerSearchText } from "../domain/display";

const normalize = (value: string): string => value.trim().toLowerCase();

export const filterEdgesByThreshold = (data: DerivedGraphResult, minSharedCount: number): ServerEdge[] => {
  const threshold = Math.max(1, Math.floor(minSharedCount));
  return data.graph.serverEdges.filter((edge) => edge.sharedUserCount >= threshold);
};

export const filterServersBySearch = (nodes: ServerNode[], searchTerm: string): ServerNode[] => {
  const term = normalize(searchTerm);
  if (!term) return nodes;
  return nodes.filter((node) => getServerSearchText(node.name).includes(term) || normalize(node.id).includes(term));
};

export const findFirstServerMatch = (nodes: ServerNode[], searchTerm: string): ServerNode | null => {
  const matches = filterServersBySearch(nodes, searchTerm);
  return matches[0] ?? null;
};

export const getEdgeVisibleCount = (data: DerivedGraphResult, minSharedCount: number): number =>
  filterEdgesByThreshold(data, minSharedCount).length;

export const getServerNameById = (data: DerivedGraphResult, serverId: string): string =>
  data.indices.serversById[serverId]?.name ?? serverId;
