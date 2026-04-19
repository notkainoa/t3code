import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ExtensionProvider } from "./extensionCatalog";
import { resolveStorage } from "./lib/storage";

const EXTENSION_MANAGER_STORAGE_KEY = "t3code:extension-manager:v1";

interface ExtensionManagerPersistedState {
  globalInstallIds: string[];
  projectInstallIdsByProjectKey: Record<string, string[]>;
  preferredPluginProvider: ExtensionProvider;
}

interface ExtensionManagerState extends ExtensionManagerPersistedState {
  draggingExtensionId: string | null;
  installGlobally: (extensionId: string) => void;
  uninstallGlobally: (extensionId: string) => void;
  assignToProject: (extensionId: string, projectKey: string) => void;
  removeFromProject: (extensionId: string, projectKey: string) => void;
  setPreferredPluginProvider: (provider: ExtensionProvider) => void;
  setDraggingExtensionId: (extensionId: string | null) => void;
}

const DEFAULT_EXTENSION_MANAGER_STATE: ExtensionManagerPersistedState = {
  globalInstallIds: [],
  projectInstallIdsByProjectKey: {},
  preferredPluginProvider: "codex",
};

function appendUnique(values: readonly string[], nextValue: string): string[] {
  return values.includes(nextValue) ? [...values] : [...values, nextValue];
}

function removeValue(values: readonly string[], removedValue: string): string[] {
  return values.filter((value) => value !== removedValue);
}

export const useExtensionManagerStore = create<ExtensionManagerState>()(
  persist(
    (set) => ({
      ...DEFAULT_EXTENSION_MANAGER_STATE,
      draggingExtensionId: null,
      installGlobally: (extensionId) =>
        set((state) => ({
          globalInstallIds: appendUnique(state.globalInstallIds, extensionId),
        })),
      uninstallGlobally: (extensionId) =>
        set((state) => ({
          globalInstallIds: removeValue(state.globalInstallIds, extensionId),
        })),
      assignToProject: (extensionId, projectKey) =>
        set((state) => ({
          projectInstallIdsByProjectKey: {
            ...state.projectInstallIdsByProjectKey,
            [projectKey]: appendUnique(
              state.projectInstallIdsByProjectKey[projectKey] ?? [],
              extensionId,
            ),
          },
        })),
      removeFromProject: (extensionId, projectKey) =>
        set((state) => {
          const current = state.projectInstallIdsByProjectKey[projectKey] ?? [];
          const next = removeValue(current, extensionId);
          if (next.length > 0) {
            return {
              projectInstallIdsByProjectKey: {
                ...state.projectInstallIdsByProjectKey,
                [projectKey]: next,
              },
            };
          }
          const { [projectKey]: _removed, ...rest } = state.projectInstallIdsByProjectKey;
          return {
            projectInstallIdsByProjectKey: rest,
          };
        }),
      setPreferredPluginProvider: (provider) => set({ preferredPluginProvider: provider }),
      setDraggingExtensionId: (extensionId) => set({ draggingExtensionId: extensionId }),
    }),
    {
      name: EXTENSION_MANAGER_STORAGE_KEY,
      partialize: (state) => ({
        globalInstallIds: state.globalInstallIds,
        projectInstallIdsByProjectKey: state.projectInstallIdsByProjectKey,
        preferredPluginProvider: state.preferredPluginProvider,
      }),
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);
