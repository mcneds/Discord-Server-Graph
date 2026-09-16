import { create } from "zustand";
import type { DerivedGraphResult } from "../domain/types";

export type AppView = "graph" | "servers" | "users";

export type SelectedEdge = {
  sourceServerId: string;
  targetServerId: string;
};

type DeriveStatus = "idle" | "deriving" | "ready" | "error";

type GraphState = {
  status: DeriveStatus;
  errorMessage: string | null;
  data: DerivedGraphResult | null;
  view: AppView;
  minSharedCount: number;
  inspectorListLimit: number;
  excludeBots: boolean;
  searchTerm: string;
  selectedServerId: string | null;
  selectedEdge: SelectedEdge | null;
  beginDerive: () => void;
  setDeriveSuccess: (payload: DerivedGraphResult) => void;
  setDeriveError: (message: string) => void;
  setView: (view: AppView) => void;
  setMinSharedCount: (value: number) => void;
  setInspectorListLimit: (value: number) => void;
  setExcludeBots: (value: boolean) => void;
  setSearchTerm: (value: string) => void;
  selectServer: (serverId: string | null) => void;
  selectEdge: (edge: SelectedEdge | null) => void;
  reset: () => void;
};

export const useGraphStore = create<GraphState>((set) => ({
  status: "idle",
  errorMessage: null,
  data: null,
  view: "servers",
  minSharedCount: 2,
  inspectorListLimit: 5,
  excludeBots: false,
  searchTerm: "",
  selectedServerId: null,
  selectedEdge: null,

  beginDerive: () => {
    set({
      status: "deriving",
      errorMessage: null,
      selectedEdge: null
    });
  },

  setDeriveSuccess: (payload) => {
    set((state) => ({
      status: "ready",
      errorMessage: null,
      data: payload,
      selectedServerId:
        state.selectedServerId && payload.indices.serversById[state.selectedServerId]
          ? state.selectedServerId
          : payload.graph.serverNodes[0]?.id ?? null,
      selectedEdge: null
    }));
  },

  setDeriveError: (message) => {
    set({
      status: "error",
      errorMessage: message,
      data: null,
      selectedServerId: null,
      selectedEdge: null
    });
  },

  setView: (view) => set({ view }),

  setMinSharedCount: (value) => {
    set({ minSharedCount: Math.max(1, Math.floor(value)) });
  },

  setInspectorListLimit: (value) => {
    const next = Number.isFinite(value) ? Math.floor(value) : 5;
    set({ inspectorListLimit: Math.max(1, Math.min(50, next)) });
  },

  setExcludeBots: (value) => set({ excludeBots: Boolean(value) }),

  setSearchTerm: (value) => set({ searchTerm: value }),

  selectServer: (serverId) => {
    set({ selectedServerId: serverId, selectedEdge: null });
  },

  selectEdge: (edge) => {
    set({ selectedEdge: edge, selectedServerId: null });
  },

  reset: () => {
    set({
      status: "idle",
      errorMessage: null,
      data: null,
      view: "servers",
      minSharedCount: 2,
      inspectorListLimit: 5,
      excludeBots: false,
      searchTerm: "",
      selectedServerId: null,
      selectedEdge: null
    });
  }
}));
