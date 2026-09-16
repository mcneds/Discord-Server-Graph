import { getServerDisplayName, getServerSearchText } from "./display";
import type { DerivedGraphResult, ServerNode, UserProfile } from "./types";

type UserRankMode = "mutual" | "diverse";

export type ServerTableRow = {
  node: ServerNode;
  strongestName: string;
  strongestWeight: number;
  averageOverlap: number;
};

type RankedServer = {
  id: string;
  name: string;
};

export type UserRankingRow = {
  user: UserProfile;
  serverPreview: string[];
  servers: RankedServer[];
};

const MAX_CACHE_KEYS_PER_DATASET = 24;

const serverTableCache = new WeakMap<DerivedGraphResult, Map<string, ServerTableRow[]>>();
const userRankingCache = new WeakMap<DerivedGraphResult, Map<string, UserRankingRow[]>>();

const normalize = (value: string): string => value.trim().toLowerCase();

const setLimited = <T>(cache: Map<string, T>, key: string, value: T): void => {
  if (cache.size >= MAX_CACHE_KEYS_PER_DATASET && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
};

const getPerDatasetCache = <T>(
  bucket: WeakMap<DerivedGraphResult, Map<string, T>>,
  data: DerivedGraphResult
): Map<string, T> => {
  const existing = bucket.get(data);
  if (existing) return existing;
  const created = new Map<string, T>();
  bucket.set(data, created);
  return created;
};

const matchesSearchTerm = (node: ServerNode, term: string): boolean => {
  if (!term) return true;
  return getServerSearchText(node.name).includes(term) || normalize(node.id).includes(term);
};

export const getCachedServerTableRows = (data: DerivedGraphResult, searchTerm: string): ServerTableRow[] => {
  const term = normalize(searchTerm);
  const cacheKey = `servers|${term}`;
  const perDataCache = getPerDatasetCache(serverTableCache, data);
  const cached = perDataCache.get(cacheKey);
  if (cached) return cached;

  const rows = data.graph.serverNodes
    .filter((node) => matchesSearchTerm(node, term))
    .map((node) => {
      const insight = data.insights.byServer[node.id];
      const strongestName = insight?.strongestNeighborId
        ? getServerDisplayName(data.indices.serversById[insight.strongestNeighborId]?.name ?? insight.strongestNeighborId, true)
        : "-";
      const averageOverlap = node.connectedServerCount > 0 ? node.weightedDegree / node.connectedServerCount : 0;

      return {
        node,
        strongestName,
        strongestWeight: insight?.strongestEdgeWeight ?? 0,
        averageOverlap
      };
    });

  setLimited(perDataCache, cacheKey, rows);
  return rows;
};

export const getCachedUserRankingRows = (
  data: DerivedGraphResult,
  rankMode: UserRankMode,
  excludeBots: boolean,
  searchTerm: string
): UserRankingRow[] => {
  const term = normalize(searchTerm);
  const cacheKey = `users|${rankMode}|${excludeBots ? "1" : "0"}|${term}`;
  const perDataCache = getPerDatasetCache(userRankingCache, data);
  const cached = perDataCache.get(cacheKey);
  if (cached) return cached;

  const users = Object.values(data.indices.usersById)
    .filter((user) => (excludeBots ? !user.isBot : true))
    .sort((a, b) => {
      if (rankMode === "diverse") {
        const aBridge = a.bridgeScore ?? a.interestingScore;
        const bBridge = b.bridgeScore ?? b.interestingScore;
        if (bBridge !== aBridge) return bBridge - aBridge;
        const aTop = a.bridgeTopTwoSizes ?? [0, 0];
        const bTop = b.bridgeTopTwoSizes ?? [0, 0];
        const aMinTop = Math.min(aTop[0], aTop[1]);
        const bMinTop = Math.min(bTop[0], bTop[1]);
        if (bMinTop !== aMinTop) return bMinTop - aMinTop;
      }
      if (b.mutualServerCount !== a.mutualServerCount) return b.mutualServerCount - a.mutualServerCount;
      const aName = a.displayName ?? a.username ?? "";
      const bName = b.displayName ?? b.username ?? "";
      return aName.localeCompare(bName, undefined, { sensitivity: "base" });
    })
    .slice(0, 1500);

  const rows = users
    .filter((user) => {
      if (!term) return true;
      const label = `${user.displayName ?? ""} ${user.username ?? ""} ${user.id}`.toLowerCase();
      return label.includes(term);
    })
    .map((user) => {
      const serverIds = data.indices.userToServers[user.id] ?? [];
      const serverNames = serverIds.map((serverId) =>
        getServerDisplayName(data.indices.serversById[serverId]?.name ?? serverId, true)
      );

      return {
        user,
        serverPreview: serverNames.slice(0, 3),
        servers: serverIds.map((serverId, index) => ({
          id: serverId,
          name: serverNames[index]
        }))
      };
    });

  setLimited(perDataCache, cacheKey, rows);
  return rows;
};
