export type RawMemberV1 = {
  user_id?: string;
  username?: string | null;
  display_name?: string | null;
  is_bot?: boolean;
  user_icon_url?: string | null;
};

export type RawServerV1 = {
  server_id?: string;
  server_name?: string | null;
  server_icon_url?: string | null;
  members?: RawMemberV1[];
};

export type RawExportV1 = {
  exported_at?: string;
  source?: string;
  servers?: RawServerV1[];
};

export type Membership = {
  serverId: string;
  userId: string;
};

export type ServerEntity = {
  id: string;
  name: string;
  iconUrl: string | null;
};

export type UserProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  isBot: boolean;
  userIconUrl: string | null;
  mutualServerCount: number;
  separationScore: number;
  interestingScore: number;
  bridgeScore?: number;
  bridgeConfidence?: number;
  bridgeIslands?: number;
  bridgeMeaningfulIslands?: number;
  bridgeTopTwoSizes?: [number, number];
  bridgeTopTwoDistance?: number;
  bridgeLargestIslandShare?: number;
};

export type ServerNode = {
  id: string;
  name: string;
  iconUrl: string | null;
  collectedUserCount: number;
  connectedServerCount: number;
  weightedDegree: number;
  communityId?: number;
};

export type ServerEdge = {
  sourceServerId: string;
  targetServerId: string;
  sharedUserCount: number;
  similarity?: number;
};

export type NeighborLink = {
  serverId: string;
  sharedUserCount: number;
};

export type TopNeighbor = {
  serverId: string;
  serverName: string;
  sharedUserCount: number;
};

export type BridgeUser = {
  userId: string;
  username: string | null;
  displayName: string | null;
  mutualServerCount: number;
  bridgeScore: number;
  confidence: number;
  islands: number;
  meaningfulIslands: number;
  topTwoSizes: [number, number];
  topTwoDistance: number;
  largestIslandShare: number;
  isBot: boolean;
};

export type HistogramBucket = {
  mutualServerCount: number;
  userCount: number;
};

export type CommunityComposition = {
  communityId: number;
  sharedWeight: number;
  serverCount: number;
};

export type ServerInsights = {
  strongestNeighborId: string | null;
  strongestEdgeWeight: number;
  topNeighbors: TopNeighbor[];
  topBridgeUsers: BridgeUser[];
  mutualHistogram: HistogramBucket[];
  communityComposition: CommunityComposition[];
};

export type DensestCluster = {
  serverIds: string[];
  serverNames: string[];
  nodeCount: number;
  edgeCount: number;
  density: number;
};

export type GlobalInsights = {
  totals: {
    servers: number;
    uniqueUsers: number;
    serverEdges: number;
    memberships: number;
  };
  topServers: ServerNode[];
  topUsers: UserProfile[];
  topBridgeUsers: BridgeUser[];
  mostConnectedServer: ServerNode | null;
  mostConnectedUser: UserProfile | null;
  densestCluster: DensestCluster | null;
};

export type UserModeScore = {
  separationScore: number;
  interestingScore: number;
  bridgeScore: number;
  bridgeConfidence: number;
  islands: number;
  meaningfulIslands: number;
  topTwoSizes: [number, number];
  topTwoDistance: number;
  largestIslandShare: number;
};

export type AnalysisMode = "tfidf_knn" | "svd_latent" | "fingerprint_2hop";

export type AnalysisDiagnostics = {
  deriveMs: number;
  edgeCount: number;
  communityCount: number;
  similarityQuantiles: number[];
  parameters: {
    k: number;
    minSimilarity: number;
    embeddingDimensions?: number;
    fingerprintK?: number;
    fingerprintMinSimilarity?: number;
  };
};

export type AnalysisModeResult = {
  graph: {
    serverNodes: ServerNode[];
    serverEdges: ServerEdge[];
    adjacency: Record<string, NeighborLink[]>;
    communities: Record<string, number>;
  };
  insights: {
    byServer: Record<string, ServerInsights>;
    global: GlobalInsights;
    bridgeUsers: BridgeUser[];
    userScores: Record<string, UserModeScore>;
  };
  diagnostics: AnalysisDiagnostics;
};

export type AnalysisPayload = {
  defaultMode: AnalysisMode;
  modes: Record<AnalysisMode, AnalysisModeResult>;
};

export type DerivedGraphResult = {
  meta: {
    exportedAt: string | null;
    source: string | null;
    coverageNote: string;
    issues: string[];
  };
  indices: {
    serversById: Record<string, ServerEntity>;
    usersById: Record<string, UserProfile>;
    memberships: Membership[];
    serverToUsers: Record<string, string[]>;
    userToServers: Record<string, string[]>;
    droppedMembershipRows: number;
    dedupedMembershipRows: number;
  };
  analysis: AnalysisPayload;
  graph: {
    serverNodes: ServerNode[];
    serverEdges: ServerEdge[];
    adjacency: Record<string, NeighborLink[]>;
  };
  insights: {
    byServer: Record<string, ServerInsights>;
    global: GlobalInsights;
  };
};

export type DeriveGraphFromRawMessage = {
  type: "DERIVE_GRAPH_FROM_RAW";
  payload: RawExportV1;
};

export type DeriveGraphFromJsonTextMessage = {
  type: "DERIVE_GRAPH_FROM_JSON_TEXT";
  payload: string;
};

export type WorkerRequestMessage =
  | DeriveGraphFromRawMessage
  | DeriveGraphFromJsonTextMessage;

export type WorkerSuccessMessage = {
  type: "DERIVE_GRAPH_SUCCESS";
  payload: DerivedGraphResult;
};

export type WorkerErrorMessage = {
  type: "DERIVE_GRAPH_ERROR";
  error: {
    code: "INVALID_INPUT" | "DERIVE_FAILED";
    message: string;
    details?: string[];
  };
};

export type WorkerResponseMessage = WorkerSuccessMessage | WorkerErrorMessage;
