import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { cpaNodeApi, type CPANode } from '@/services/api/usageService';

const STORAGE_KEY = 'cpa-manager-plus-current-node';

export interface CPANodeStoreState {
  nodes: CPANode[];
  currentNodeId: string;
  loading: boolean;
  error: string;
  setCurrentNodeId: (nodeId: string) => void;
  fetchNodes: (base: string, managementKey?: string) => Promise<void>;
  selectedNode: () => CPANode | undefined;
}

export const useCPANodeStore = create<CPANodeStoreState>()(
  persist(
    (set, get) => ({
      nodes: [],
      currentNodeId: '',
      loading: false,
      error: '',
      setCurrentNodeId: (nodeId) => set({ currentNodeId: nodeId }),
      fetchNodes: async (base, managementKey) => {
        set({ loading: true, error: '' });
        try {
          const nodes = await cpaNodeApi.list(base, managementKey);
          const currentNodeId = resolveCurrentNodeId(nodes, get().currentNodeId);
          set({ nodes, currentNodeId, loading: false });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error), loading: false });
        }
      },
      selectedNode: () => get().nodes.find((node) => node.id === get().currentNodeId),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ currentNodeId: state.currentNodeId }),
    }
  )
);

function resolveCurrentNodeId(nodes: CPANode[], currentNodeId: string): string {
  if (currentNodeId && nodes.some((node) => node.id === currentNodeId)) {
    return currentNodeId;
  }
  return nodes.find((node) => node.enabled)?.id ?? nodes[0]?.id ?? '';
}
