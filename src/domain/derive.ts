import {
  type AnalysisModeResult,
  type BridgeUser,
  type DerivedGraphResult,
  type DensestCluster,
  type GlobalInsights,
  type HistogramBucket,
  type RawExportV1,
  type ServerEdge,
  type ServerEntity,
  type ServerInsights,
  type ServerNode,
  type UserModeScore,
  type UserProfile
} from "./types";

const COVERAGE_NOTE = "Insights are based on collected scrape data and may not represent complete Discord ground truth.";

const toId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const compareStrings = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const getEdgeKey = edgeKey;

const BRIDGE_MIN_SIMILARITY = 0.15;
const BRIDGE_TOP_K = 30;
const BRIDGE_MIN_MUTUALS_FOR_SCORE = 6;
const BRIDGE_SVD_DIMS = 64;
const BRIDGE_SVD_ITERS = 32;

const sortUsers = (users: UserProfile[]): UserProfile[] => {
  return [...users].sort((a, b) => {
    if (b.mutualServerCount !== a.mutualServerCount) return b.mutualServerCount - a.mutualServerCount;
    const aName = a.displayName ?? a.username ?? "";
    const bName = b.displayName ?? b.username ?? "";
    const byName = compareStrings(aName, bName);
    if (byName !== 0) return byName;
    return compareStrings(a.id, b.id);
  });
};

const sortServers = (servers: ServerNode[]): ServerNode[] => {
  return [...servers].sort((a, b) => {
    if (b.connectedServerCount !== a.connectedServerCount) return b.connectedServerCount - a.connectedServerCount;
    if (b.weightedDegree !== a.weightedDegree) return b.weightedDegree - a.weightedDegree;
    if (b.collectedUserCount !== a.collectedUserCount) return b.collectedUserCount - a.collectedUserCount;
    return compareStrings(a.id, b.id);
  });
};

const normalizeRaw = (raw: RawExportV1): {
  serversById: Record<string, ServerEntity>;
  usersById: Record<string, UserProfile>;
  memberships: Array<{ serverId: string; userId: string }>;
  serverToUsers: Record<string, string[]>;
  userToServers: Record<string, string[]>;
  droppedMembershipRows: number;
  dedupedMembershipRows: number;
  issues: string[];
} => {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object") {
    throw new Error("Input payload must be an object.");
  }

  if (!Array.isArray(raw.servers)) {
    throw new Error("Input payload is missing servers[].");
  }

  const serverMap = new Map<string, ServerEntity>();
  const userDraftMap = new Map<
    string,
    {
      id: string;
      username: string | null;
      displayName: string | null;
      isBot: boolean;
      userIconUrl: string | null;
    }
  >();
  const serverToUsersMap = new Map<string, Set<string>>();
  const userToServersMap = new Map<string, Set<string>>();
  const memberships: Array<{ serverId: string; userId: string }> = [];

  let droppedMembershipRows = 0;
  let dedupedMembershipRows = 0;

  for (const rawServer of raw.servers) {
    const serverId = toId(rawServer?.server_id);
    if (!serverId) {
      issues.push("Dropped a server row with missing server_id.");
      continue;
    }

    const existingServer = serverMap.get(serverId);
    const serverName = toOptionalText(rawServer?.server_name) ?? existingServer?.name ?? `Server ${serverId}`;
    const serverIconUrl = toOptionalText(rawServer?.server_icon_url) ?? existingServer?.iconUrl ?? null;

    serverMap.set(serverId, {
      id: serverId,
      name: serverName,
      iconUrl: serverIconUrl
    });

    let serverUsers = serverToUsersMap.get(serverId);
    if (!serverUsers) {
      serverUsers = new Set<string>();
      serverToUsersMap.set(serverId, serverUsers);
    }

    const members = Array.isArray(rawServer?.members) ? rawServer.members : [];
    for (const rawMember of members) {
      const userId = toId(rawMember?.user_id);
      if (!userId) {
        droppedMembershipRows += 1;
        continue;
      }

      if (serverUsers.has(userId)) {
        dedupedMembershipRows += 1;
        continue;
      }

      serverUsers.add(userId);
      memberships.push({ serverId, userId });

      let userServers = userToServersMap.get(userId);
      if (!userServers) {
        userServers = new Set<string>();
        userToServersMap.set(userId, userServers);
      }
      userServers.add(serverId);

      const existingUser = userDraftMap.get(userId);
      const username = toOptionalText(rawMember?.username);
      const displayName = toOptionalText(rawMember?.display_name);
      const userIconUrl = toOptionalText(rawMember?.user_icon_url);
      const isBot = Boolean(rawMember?.is_bot);

      if (!existingUser) {
        userDraftMap.set(userId, {
          id: userId,
          username,
          displayName,
          isBot,
          userIconUrl
        });
      } else {
        if (!existingUser.username && username) existingUser.username = username;
        if (!existingUser.displayName && displayName) existingUser.displayName = displayName;
        if (!existingUser.userIconUrl && userIconUrl) existingUser.userIconUrl = userIconUrl;
        existingUser.isBot = existingUser.isBot || isBot;
      }
    }
  }

  const usersById: Record<string, UserProfile> = {};
  for (const [userId, userDraft] of userDraftMap.entries()) {
    usersById[userId] = {
      id: userDraft.id,
      username: userDraft.username,
      displayName: userDraft.displayName,
      isBot: userDraft.isBot,
      userIconUrl: userDraft.userIconUrl,
      mutualServerCount: userToServersMap.get(userId)?.size ?? 0,
      separationScore: 0,
      interestingScore: 0
    };
  }

  const serverToUsers: Record<string, string[]> = {};
  for (const [serverId, users] of serverToUsersMap.entries()) {
    serverToUsers[serverId] = [...users].sort(compareStrings);
  }

  const userToServers: Record<string, string[]> = {};
  for (const [userId, servers] of userToServersMap.entries()) {
    userToServers[userId] = [...servers].sort(compareStrings);
  }

  if (droppedMembershipRows > 0) {
    issues.push(`Dropped ${droppedMembershipRows} membership rows with missing user_id.`);
  }
  if (dedupedMembershipRows > 0) {
    issues.push(`Deduplicated ${dedupedMembershipRows} duplicate membership rows.`);
  }

  return {
    serversById: Object.fromEntries(serverMap.entries()),
    usersById,
    memberships,
    serverToUsers,
    userToServers,
    droppedMembershipRows,
    dedupedMembershipRows,
    issues
  };
};

const deriveServerEdges = (
  userToServers: Record<string, string[]>
): { edges: ServerEdge[]; edgeWeights: Map<string, number> } => {
  const edgeWeights = new Map<string, number>();

  for (const serverIds of Object.values(userToServers)) {
    if (serverIds.length < 2) continue;
    for (let i = 0; i < serverIds.length; i += 1) {
      for (let j = i + 1; j < serverIds.length; j += 1) {
        const key = edgeKey(serverIds[i], serverIds[j]);
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: ServerEdge[] = [];
  for (const [key, sharedUserCount] of edgeWeights.entries()) {
    const [sourceServerId, targetServerId] = key.split("|");
    edges.push({ sourceServerId, targetServerId, sharedUserCount });
  }

  edges.sort((a, b) => {
    if (b.sharedUserCount !== a.sharedUserCount) return b.sharedUserCount - a.sharedUserCount;
    const bySource = compareStrings(a.sourceServerId, b.sourceServerId);
    if (bySource !== 0) return bySource;
    return compareStrings(a.targetServerId, b.targetServerId);
  });

  return {
    edges,
    edgeWeights
  };
};

const deriveAdjacency = (serverIds: string[], edges: ServerEdge[]) => {
  const adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>> = {};
  for (const serverId of serverIds) adjacency[serverId] = [];

  for (const edge of edges) {
    adjacency[edge.sourceServerId]?.push({
      serverId: edge.targetServerId,
      sharedUserCount: edge.sharedUserCount
    });
    adjacency[edge.targetServerId]?.push({
      serverId: edge.sourceServerId,
      sharedUserCount: edge.sharedUserCount
    });
  }

  for (const serverId of serverIds) {
    adjacency[serverId].sort((a, b) => {
      if (b.sharedUserCount !== a.sharedUserCount) return b.sharedUserCount - a.sharedUserCount;
      return compareStrings(a.serverId, b.serverId);
    });
  }

  return adjacency;
};

const dotFloat64 = (a: Float64Array, b: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
};

const normFloat64 = (a: Float64Array): number => Math.sqrt(dotFloat64(a, a));

const orthonormalizeVector = (vector: Float64Array, basis: Float64Array[]): void => {
  for (const axis of basis) {
    const projection = dotFloat64(vector, axis);
    if (projection === 0) continue;
    for (let i = 0; i < vector.length; i += 1) {
      vector[i] -= projection * axis[i];
    }
  }
};

const multiplySymmetricMatrixVector = (matrix: Float64Array, size: number, vector: Float64Array): Float64Array => {
  const out = new Float64Array(size);
  for (let row = 0; row < size; row += 1) {
    let sum = 0;
    const offset = row * size;
    for (let col = 0; col < size; col += 1) {
      sum += matrix[offset + col] * vector[col];
    }
    out[row] = sum;
  }
  return out;
};

const topEigenpairsSymmetric = (
  matrix: Float64Array,
  size: number,
  targetDims: number,
  iterations = BRIDGE_SVD_ITERS
): { vectors: Float64Array[]; values: number[] } => {
  const dims = Math.max(1, Math.min(size, targetDims));
  const vectors: Float64Array[] = [];
  const values: number[] = [];

  for (let d = 0; d < dims; d += 1) {
    const vector = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      vector[i] = Math.random() - 0.5;
    }

    orthonormalizeVector(vector, vectors);
    let currentNorm = normFloat64(vector);
    if (currentNorm <= 1e-12) break;
    for (let i = 0; i < size; i += 1) vector[i] /= currentNorm;

    for (let iter = 0; iter < iterations; iter += 1) {
      const multiplied = multiplySymmetricMatrixVector(matrix, size, vector);
      orthonormalizeVector(multiplied, vectors);
      const nextNorm = normFloat64(multiplied);
      if (nextNorm <= 1e-12) {
        currentNorm = 0;
        break;
      }
      currentNorm = nextNorm;
      for (let i = 0; i < size; i += 1) vector[i] = multiplied[i] / nextNorm;
    }

    if (currentNorm <= 1e-12) continue;
    const multiplied = multiplySymmetricMatrixVector(matrix, size, vector);
    const eigenValue = dotFloat64(vector, multiplied);
    if (!Number.isFinite(eigenValue) || eigenValue <= 1e-9) break;

    vectors.push(Float64Array.from(vector));
    values.push(eigenValue);
  }

  return { vectors, values };
};

const deriveBridgeAdjacency = (
  serverIds: string[],
  userToServers: Record<string, string[]>,
  edgeWeights: Map<string, number>,
  minSimilarity = BRIDGE_MIN_SIMILARITY,
  topK = BRIDGE_TOP_K,
  embeddingDims = BRIDGE_SVD_DIMS
): {
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>;
  similarityByKey: Map<string, number>;
} => {
  const adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>> = {};
  for (const serverId of serverIds) adjacency[serverId] = [];

  if (serverIds.length <= 1) {
    return {
      adjacency,
      similarityByKey: new Map()
    };
  }

  const serverIndex = new Map<string, number>();
  for (let i = 0; i < serverIds.length; i += 1) serverIndex.set(serverIds[i], i);

  const serverNormSq = new Float64Array(serverIds.length);
  const idfByUser = new Map<string, number>();
  const serverCount = serverIds.length;

  for (const [userId, memberships] of Object.entries(userToServers)) {
    if (memberships.length === 0) continue;
    const df = memberships.length;
    const idf = Math.log((serverCount + 1) / (df + 1)) + 1;
    idfByUser.set(userId, idf);
    const idfSquared = idf * idf;
    for (const serverId of memberships) {
      const index = serverIndex.get(serverId);
      if (index === undefined) continue;
      serverNormSq[index] += idfSquared;
    }
  }

  const serverNorm = new Float64Array(serverIds.length);
  for (let i = 0; i < serverIds.length; i += 1) {
    serverNorm[i] = Math.sqrt(serverNormSq[i] || 1);
  }

  // Gram matrix G = A A^T where A is l2-normalized TF-IDF server-user matrix.
  const gram = new Float64Array(serverIds.length * serverIds.length);
  for (const [userId, memberships] of Object.entries(userToServers)) {
    if (memberships.length === 0) continue;
    const idf = idfByUser.get(userId);
    if (!idf) continue;
    const coeffSquared = idf * idf;

    for (let i = 0; i < memberships.length; i += 1) {
      const idxA = serverIndex.get(memberships[i]);
      if (idxA === undefined) continue;
      const diagContribution = coeffSquared / (serverNorm[idxA] * serverNorm[idxA]);
      gram[idxA * serverIds.length + idxA] += diagContribution;

      for (let j = i + 1; j < memberships.length; j += 1) {
        const idxB = serverIndex.get(memberships[j]);
        if (idxB === undefined) continue;
        const contribution = coeffSquared / (serverNorm[idxA] * serverNorm[idxB]);
        gram[idxA * serverIds.length + idxB] += contribution;
        gram[idxB * serverIds.length + idxA] += contribution;
      }
    }
  }

  const { vectors, values } = topEigenpairsSymmetric(gram, serverIds.length, Math.min(embeddingDims, serverIds.length));
  const dims = values.length;
  if (dims === 0) {
    return {
      adjacency,
      similarityByKey: new Map()
    };
  }

  const embeddings = Array.from({ length: serverIds.length }, () => new Float64Array(dims));
  for (let d = 0; d < dims; d += 1) {
    const scale = Math.sqrt(Math.max(0, values[d]));
    const axis = vectors[d];
    for (let i = 0; i < serverIds.length; i += 1) {
      embeddings[i][d] = axis[i] * scale;
    }
  }

  for (let i = 0; i < serverIds.length; i += 1) {
    const rowNorm = normFloat64(embeddings[i]);
    if (rowNorm <= 1e-12) continue;
    for (let d = 0; d < dims; d += 1) embeddings[i][d] /= rowNorm;
  }

  const directed = new Map<string, Array<{ serverId: string; similarity: number }>>();
  for (const serverId of serverIds) directed.set(serverId, []);

  for (let i = 0; i < serverIds.length; i += 1) {
    const sourceId = serverIds[i];
    const candidates: Array<{ serverId: string; similarity: number }> = [];
    for (let j = 0; j < serverIds.length; j += 1) {
      if (i === j) continue;
      const similarity = dotFloat64(embeddings[i], embeddings[j]);
      if (similarity < minSimilarity) continue;
      candidates.push({ serverId: serverIds[j], similarity });
    }
    candidates.sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return compareStrings(a.serverId, b.serverId);
    });
    directed.set(sourceId, candidates.slice(0, Math.max(1, topK)));
  }

  const similarityByKey = new Map<string, number>();
  for (const [sourceId, neighbors] of directed.entries()) {
    for (const neighbor of neighbors) {
      const key = edgeKey(sourceId, neighbor.serverId);
      if ((similarityByKey.get(key) ?? 0) < neighbor.similarity) {
        similarityByKey.set(key, neighbor.similarity);
      }
    }
  }

  for (const [key, similarity] of similarityByKey.entries()) {
    if (similarity < minSimilarity) continue;
    const [a, b] = key.split("|");
    const sharedUserCount = edgeWeights.get(key) ?? 1;
    adjacency[a].push({ serverId: b, sharedUserCount });
    adjacency[b].push({ serverId: a, sharedUserCount });
  }

  for (const serverId of serverIds) {
    adjacency[serverId].sort((a, b) => {
      const simA = similarityByKey.get(edgeKey(serverId, a.serverId)) ?? 0;
      const simB = similarityByKey.get(edgeKey(serverId, b.serverId)) ?? 0;
      if (simB !== simA) return simB - simA;
      return compareStrings(a.serverId, b.serverId);
    });
  }

  return {
    adjacency,
    similarityByKey
  };
};

const deriveServerNodes = (
  serversById: Record<string, ServerEntity>,
  serverToUsers: Record<string, string[]>,
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>
): ServerNode[] => {
  const nodes: ServerNode[] = [];

  for (const [serverId, server] of Object.entries(serversById)) {
    const neighbors = adjacency[serverId] ?? [];
    const weightedDegree = neighbors.reduce((sum, item) => sum + item.sharedUserCount, 0);
    nodes.push({
      id: serverId,
      name: server.name,
      iconUrl: server.iconUrl,
      collectedUserCount: serverToUsers[serverId]?.length ?? 0,
      connectedServerCount: neighbors.length,
      weightedDegree
    });
  }

  return sortServers(nodes);
};

const deriveBridgeUsers = (
  userIds: string[],
  usersById: Record<string, UserProfile>,
  limit = 5
): BridgeUser[] => {
  const ranked = userIds
    .map((userId) => {
      const user = usersById[userId];
      if (!user) return null;
      const bridgeScore = Math.max(0, user.bridgeScore ?? 0);
      const confidence = Math.max(0, user.bridgeConfidence ?? 0);
      const islands = Math.max(0, user.bridgeIslands ?? 0);
      const meaningfulIslands = Math.max(0, user.bridgeMeaningfulIslands ?? 0);
      const topTwoSizes = user.bridgeTopTwoSizes ?? [0, 0];
      const topTwoDistance = Math.max(0, user.bridgeTopTwoDistance ?? 0);
      const largestIslandShare = Math.max(0, user.bridgeLargestIslandShare ?? 0);
      return {
        userId,
        username: user.username,
        displayName: user.displayName,
        mutualServerCount: user.mutualServerCount,
        bridgeScore,
        confidence,
        islands,
        meaningfulIslands,
        topTwoSizes,
        topTwoDistance,
        largestIslandShare,
        isBot: user.isBot
      } satisfies BridgeUser;
    })
    .filter((value): value is BridgeUser => Boolean(value))
    .sort((a, b) => {
      if (b.bridgeScore !== a.bridgeScore) return b.bridgeScore - a.bridgeScore;
      const aMinTop = Math.min(a.topTwoSizes[0], a.topTwoSizes[1]);
      const bMinTop = Math.min(b.topTwoSizes[0], b.topTwoSizes[1]);
      if (bMinTop !== aMinTop) return bMinTop - aMinTop;
      if (b.mutualServerCount !== a.mutualServerCount) return b.mutualServerCount - a.mutualServerCount;
      const aName = a.displayName ?? a.username ?? "";
      const bName = b.displayName ?? b.username ?? "";
      const byName = compareStrings(aName, bName);
      if (byName !== 0) return byName;
      return compareStrings(a.userId, b.userId);
    });

  return ranked.slice(0, Math.max(1, limit));
};

const deriveHistogram = (userIds: string[], usersById: Record<string, UserProfile>): HistogramBucket[] => {
  const buckets = new Map<number, number>();
  for (const userId of userIds) {
    const mutualServerCount = usersById[userId]?.mutualServerCount ?? 0;
    buckets.set(mutualServerCount, (buckets.get(mutualServerCount) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .map(([mutualServerCount, userCount]) => ({ mutualServerCount, userCount }))
    .sort((a, b) => a.mutualServerCount - b.mutualServerCount);
};

const getOverlapCoefficient = (
  serverA: string,
  serverB: string,
  edgeWeights: Map<string, number>,
  serverToUsers: Record<string, string[]>
): number => {
  const shared = edgeWeights.get(edgeKey(serverA, serverB)) ?? 0;
  if (shared <= 0) return 0;
  const sizeA = Math.max(1, serverToUsers[serverA]?.length ?? 0);
  const sizeB = Math.max(1, serverToUsers[serverB]?.length ?? 0);
  return shared / Math.max(1, Math.min(sizeA, sizeB));
};

const getConnectedComponentsForUserServers = (
  serverIds: string[],
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>
): string[][] => {
  if (serverIds.length === 0) return [];
  const target = new Set(serverIds);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of serverIds) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component: string[] = [];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency[current] ?? []) {
        if (!target.has(neighbor.serverId) || visited.has(neighbor.serverId)) continue;
        visited.add(neighbor.serverId);
        queue.push(neighbor.serverId);
      }
    }

    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  return components;
};

const getTopIslandDistance = (
  islandA: string[],
  islandB: string[],
  similarityByKey: Map<string, number>
): number => {
  let crossSimilaritySum = 0;
  let crossPairs = 0;

  for (const serverA of islandA) {
    for (const serverB of islandB) {
      const similarity = similarityByKey.get(edgeKey(serverA, serverB)) ?? 0;
      if (similarity <= 0) continue;
      crossSimilaritySum += Math.min(1, similarity);
      crossPairs += 1;
    }
  }

  if (crossPairs === 0) return 1;
  const meanSimilarity = crossSimilaritySum / crossPairs;
  return Math.max(0, Math.min(1, 1 - meanSimilarity));
};

const enrichUserDiversityScores = (
  usersById: Record<string, UserProfile>,
  userToServers: Record<string, string[]>,
  serverToUsers: Record<string, string[]>,
  edgeWeights: Map<string, number>,
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>,
  similarityByKey: Map<string, number>
): void => {
  for (const [userId, user] of Object.entries(usersById)) {
    const serverIds = userToServers[userId] ?? [];
    const mutuals = serverIds.length;
    if (serverIds.length < 2) {
      user.separationScore = 0;
      user.interestingScore = 0;
      user.bridgeScore = 0;
      user.bridgeConfidence = 0;
      user.bridgeIslands = serverIds.length;
      user.bridgeMeaningfulIslands = 0;
      user.bridgeTopTwoSizes = [0, 0];
      user.bridgeTopTwoDistance = 0;
      user.bridgeLargestIslandShare = serverIds.length > 0 ? 1 : 0;
      continue;
    }

    let pairCount = 0;
    let separationSum = 0;
    for (let i = 0; i < serverIds.length; i += 1) {
      for (let j = i + 1; j < serverIds.length; j += 1) {
        const a = serverIds[i];
        const b = serverIds[j];
        const overlapCoefficient = getOverlapCoefficient(a, b, edgeWeights, serverToUsers);
        const separation = 1 - Math.min(1, overlapCoefficient);
        separationSum += separation;
        pairCount += 1;
      }
    }

    const separationScore = pairCount > 0 ? separationSum / pairCount : 0;
    user.separationScore = separationScore;

    const components = getConnectedComponentsForUserServers(serverIds, adjacency);
    const largestIslandSize = components[0]?.length ?? 0;
    const largestIslandShare = mutuals > 0 ? largestIslandSize / mutuals : 0;
    const meaningful = components.filter((component) => component.length >= 2);

    let bridgeScore = 0;
    let confidence = Math.max(0, 1 - Math.exp(-(mutuals - 2) / 3));
    let topTwoSizes: [number, number] = [0, 0];
    let topTwoDistance = 0;

    if (mutuals >= BRIDGE_MIN_MUTUALS_FOR_SCORE && meaningful.length >= 2) {
      const top = meaningful[0];
      const second = meaningful[1];
      const s1 = top.length;
      const s2 = second.length;
      topTwoSizes = [s1, s2];
      topTwoDistance = getTopIslandDistance(top, second, similarityByKey);

      const bridgeMass = Math.min(s1, s2) * Math.sqrt(s1 * s2);
      const extraMeaningful = Math.max(0, meaningful.length - 2);
      bridgeScore = confidence * bridgeMass * topTwoDistance + 0.35 * extraMeaningful;
      if (largestIslandShare > 0.75) bridgeScore *= 0.7;
    } else {
      bridgeScore = 0;
    }

    user.bridgeScore = bridgeScore;
    user.bridgeConfidence = confidence;
    user.bridgeIslands = components.length;
    user.bridgeMeaningfulIslands = meaningful.length;
    user.bridgeTopTwoSizes = topTwoSizes;
    user.bridgeTopTwoDistance = topTwoDistance;
    user.bridgeLargestIslandShare = largestIslandShare;
    user.interestingScore = bridgeScore;
  }
};

const deriveServerInsights = (
  serverNodes: ServerNode[],
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>,
  serverToUsers: Record<string, string[]>,
  usersById: Record<string, UserProfile>,
  serversById: Record<string, ServerEntity>
): Record<string, ServerInsights> => {
  const byServer: Record<string, ServerInsights> = {};

  for (const node of serverNodes) {
    const neighbors = adjacency[node.id] ?? [];
    const strongest = neighbors[0];
    const topNeighbors = neighbors.slice(0, 5).map((neighbor) => ({
      serverId: neighbor.serverId,
      serverName: serversById[neighbor.serverId]?.name ?? neighbor.serverId,
      sharedUserCount: neighbor.sharedUserCount
    }));

    const userIds = serverToUsers[node.id] ?? [];
    byServer[node.id] = {
      strongestNeighborId: strongest?.serverId ?? null,
      strongestEdgeWeight: strongest?.sharedUserCount ?? 0,
      topNeighbors,
      topBridgeUsers: deriveBridgeUsers(userIds, usersById),
      mutualHistogram: deriveHistogram(userIds, usersById),
      communityComposition: []
    };
  }

  return byServer;
};

const deriveDensestCluster = (
  serverNodes: ServerNode[],
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>,
  serversById: Record<string, ServerEntity>
): DensestCluster | null => {
  const visited = new Set<string>();
  let best: DensestCluster | null = null;

  for (const node of serverNodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency[current] ?? []) {
        if (!visited.has(neighbor.serverId)) {
          visited.add(neighbor.serverId);
          queue.push(neighbor.serverId);
        }
      }
    }

    if (component.length < 2) continue;

    const set = new Set(component);
    let edgeCount = 0;
    for (const serverId of component) {
      for (const neighbor of adjacency[serverId] ?? []) {
        if (set.has(neighbor.serverId) && serverId < neighbor.serverId) {
          edgeCount += 1;
        }
      }
    }

    const nodeCount = component.length;
    const density = (2 * edgeCount) / (nodeCount * (nodeCount - 1));
    const candidate: DensestCluster = {
      serverIds: [...component].sort(compareStrings),
      serverNames: [...component]
        .map((id) => serversById[id]?.name ?? id)
        .sort(compareStrings),
      nodeCount,
      edgeCount,
      density
    };

    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.density > best.density) {
      best = candidate;
      continue;
    }
    if (candidate.density === best.density && candidate.nodeCount > best.nodeCount) {
      best = candidate;
    }
  }

  return best;
};

const deriveGlobalInsights = (
  serverNodes: ServerNode[],
  usersById: Record<string, UserProfile>,
  serverEdges: ServerEdge[],
  membershipsCount: number,
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>,
  serversById: Record<string, ServerEntity>
): GlobalInsights => {
  const rankedServers = sortServers(serverNodes);
  const rankedUsers = sortUsers(Object.values(usersById));
  const topBridgeUsers = deriveBridgeUsers(Object.keys(usersById), usersById, 10);

  return {
    totals: {
      servers: serverNodes.length,
      uniqueUsers: rankedUsers.length,
      serverEdges: serverEdges.length,
      memberships: membershipsCount
    },
    topServers: rankedServers.slice(0, 10),
    topUsers: rankedUsers.slice(0, 10),
    topBridgeUsers,
    mostConnectedServer: rankedServers[0] ?? null,
    mostConnectedUser: rankedUsers[0] ?? null,
    densestCluster: deriveDensestCluster(serverNodes, adjacency, serversById)
  };
};

const deriveSimilarityQuantiles = (serverEdges: ServerEdge[]): number[] => {
  if (serverEdges.length === 0) return [];
  const sorted = [...serverEdges]
    .map((edge) => edge.sharedUserCount)
    .sort((a, b) => a - b);
  const picks = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
  return picks.map((p) => {
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
    return sorted[index];
  });
};

const deriveUserModeScores = (usersById: Record<string, UserProfile>): Record<string, UserModeScore> => {
  const scores: Record<string, UserModeScore> = {};
  for (const [userId, user] of Object.entries(usersById)) {
    scores[userId] = {
      separationScore: user.separationScore,
      interestingScore: user.interestingScore,
      bridgeScore: user.bridgeScore ?? 0,
      bridgeConfidence: user.bridgeConfidence ?? 0,
      islands: user.bridgeIslands ?? 0,
      meaningfulIslands: user.bridgeMeaningfulIslands ?? 0,
      topTwoSizes: user.bridgeTopTwoSizes ?? [0, 0],
      topTwoDistance: user.bridgeTopTwoDistance ?? 0,
      largestIslandShare: user.bridgeLargestIslandShare ?? 0
    };
  }
  return scores;
};

const deriveAnalysisPayload = (
  serverNodes: ServerNode[],
  serverEdges: ServerEdge[],
  adjacency: Record<string, Array<{ serverId: string; sharedUserCount: number }>>,
  byServer: Record<string, ServerInsights>,
  global: GlobalInsights,
  usersById: Record<string, UserProfile>
): DerivedGraphResult["analysis"] => {
  const communities = Object.fromEntries(serverNodes.map((node) => [node.id, node.communityId ?? 0]));
  const userScores = deriveUserModeScores(usersById);
  const similarityQuantiles = deriveSimilarityQuantiles(serverEdges);

  const makeMode = (): AnalysisModeResult => ({
    graph: {
      serverNodes,
      serverEdges,
      adjacency,
      communities
    },
    insights: {
      byServer,
      global,
      bridgeUsers: global.topBridgeUsers,
      userScores
    },
    diagnostics: {
      deriveMs: 0,
      edgeCount: serverEdges.length,
      communityCount: new Set(Object.values(communities)).size,
      similarityQuantiles,
      parameters: {
        k: 0,
        minSimilarity: 0
      }
    }
  });

  return {
    defaultMode: "svd_latent",
    modes: {
      tfidf_knn: makeMode(),
      svd_latent: makeMode(),
      fingerprint_2hop: makeMode()
    }
  };
};

export const deriveGraphFromRaw = (raw: RawExportV1): DerivedGraphResult => {
  const normalized = normalizeRaw(raw);
  const serverIds = Object.keys(normalized.serversById).sort(compareStrings);
  const { edges: serverEdges, edgeWeights } = deriveServerEdges(normalized.userToServers);
  const adjacency = deriveAdjacency(serverIds, serverEdges);
  const bridgeGraph = deriveBridgeAdjacency(serverIds, normalized.userToServers, edgeWeights);
  enrichUserDiversityScores(
    normalized.usersById,
    normalized.userToServers,
    normalized.serverToUsers,
    edgeWeights,
    bridgeGraph.adjacency,
    bridgeGraph.similarityByKey
  );
  const serverNodes = deriveServerNodes(normalized.serversById, normalized.serverToUsers, adjacency);
  const byServer = deriveServerInsights(
    serverNodes,
    adjacency,
    normalized.serverToUsers,
    normalized.usersById,
    normalized.serversById
  );
  const global = deriveGlobalInsights(
    serverNodes,
    normalized.usersById,
    serverEdges,
    normalized.memberships.length,
    adjacency,
    normalized.serversById
  );

  return {
    meta: {
      exportedAt: toOptionalText(raw.exported_at),
      source: toOptionalText(raw.source),
      coverageNote: COVERAGE_NOTE,
      issues: normalized.issues
    },
    indices: {
      serversById: normalized.serversById,
      usersById: normalized.usersById,
      memberships: normalized.memberships,
      serverToUsers: normalized.serverToUsers,
      userToServers: normalized.userToServers,
      droppedMembershipRows: normalized.droppedMembershipRows,
      dedupedMembershipRows: normalized.dedupedMembershipRows
    },
    analysis: deriveAnalysisPayload(serverNodes, serverEdges, adjacency, byServer, global, normalized.usersById),
    graph: {
      serverNodes,
      serverEdges,
      adjacency
    },
    insights: {
      byServer,
      global
    }
  };
};

const pickBestDisplayName = (user: UserProfile): string => user.displayName ?? user.username ?? user.id;

export const getSharedUsersForEdge = (
  data: DerivedGraphResult,
  serverA: string,
  serverB: string,
  limit = 200
): UserProfile[] => {
  const aUsers = new Set(data.indices.serverToUsers[serverA] ?? []);
  const bUsers = data.indices.serverToUsers[serverB] ?? [];
  const shared: UserProfile[] = [];

  for (const userId of bUsers) {
    if (!aUsers.has(userId)) continue;
    const user = data.indices.usersById[userId];
    if (!user) continue;
    shared.push(user);
  }

  shared.sort((a, b) => {
    if (b.mutualServerCount !== a.mutualServerCount) return b.mutualServerCount - a.mutualServerCount;
    return compareStrings(pickBestDisplayName(a), pickBestDisplayName(b));
  });

  return shared.slice(0, Math.max(1, limit));
};

const botExcludedCache = new WeakMap<DerivedGraphResult, DerivedGraphResult>();

const cloneUserProfile = (user: UserProfile): UserProfile => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  isBot: user.isBot,
  userIconUrl: user.userIconUrl,
  mutualServerCount: user.mutualServerCount,
  separationScore: user.separationScore,
  interestingScore: user.interestingScore,
  bridgeScore: user.bridgeScore,
  bridgeConfidence: user.bridgeConfidence,
  bridgeIslands: user.bridgeIslands,
  bridgeMeaningfulIslands: user.bridgeMeaningfulIslands,
  bridgeTopTwoSizes: user.bridgeTopTwoSizes,
  bridgeTopTwoDistance: user.bridgeTopTwoDistance,
  bridgeLargestIslandShare: user.bridgeLargestIslandShare
});

const deriveFromAllowedUsers = (data: DerivedGraphResult, allowedUserIds: Set<string>): DerivedGraphResult => {
  const usersById: Record<string, UserProfile> = {};
  const userToServers: Record<string, string[]> = {};

  for (const [userId, user] of Object.entries(data.indices.usersById)) {
    if (!allowedUserIds.has(userId)) continue;
    usersById[userId] = cloneUserProfile(user);
    userToServers[userId] = [...(data.indices.userToServers[userId] ?? [])];
  }

  const serverToUsers: Record<string, string[]> = {};
  for (const serverId of Object.keys(data.indices.serversById)) {
    const filteredUsers = (data.indices.serverToUsers[serverId] ?? []).filter((userId) => allowedUserIds.has(userId));
    serverToUsers[serverId] = filteredUsers;
  }

  const memberships = data.indices.memberships.filter((membership) => allowedUserIds.has(membership.userId));

  const { edges: serverEdges, edgeWeights } = deriveServerEdges(userToServers);

  const serverIds = Object.keys(data.indices.serversById).sort(compareStrings);
  const adjacency = deriveAdjacency(serverIds, serverEdges);
  const bridgeGraph = deriveBridgeAdjacency(serverIds, userToServers, edgeWeights);
  enrichUserDiversityScores(usersById, userToServers, serverToUsers, edgeWeights, bridgeGraph.adjacency, bridgeGraph.similarityByKey);
  const serverNodes = deriveServerNodes(data.indices.serversById, serverToUsers, adjacency);
  const byServer = deriveServerInsights(serverNodes, adjacency, serverToUsers, usersById, data.indices.serversById);
  const global = deriveGlobalInsights(
    serverNodes,
    usersById,
    serverEdges,
    memberships.length,
    adjacency,
    data.indices.serversById
  );

  return {
    meta: data.meta,
    indices: {
      serversById: data.indices.serversById,
      usersById,
      memberships,
      serverToUsers,
      userToServers,
      droppedMembershipRows: data.indices.droppedMembershipRows,
      dedupedMembershipRows: data.indices.dedupedMembershipRows
    },
    analysis: deriveAnalysisPayload(serverNodes, serverEdges, adjacency, byServer, global, usersById),
    graph: {
      serverNodes,
      serverEdges,
      adjacency
    },
    insights: {
      byServer,
      global
    }
  };
};

export const getDerivedGraphForBotMode = (data: DerivedGraphResult, excludeBots: boolean): DerivedGraphResult => {
  if (!excludeBots) return data;

  const cached = botExcludedCache.get(data);
  if (cached) return cached;

  const allowedUserIds = new Set(
    Object.values(data.indices.usersById)
      .filter((user) => !user.isBot)
      .map((user) => user.id)
  );

  const derived = deriveFromAllowedUsers(data, allowedUserIds);
  botExcludedCache.set(data, derived);
  return derived;
};



