import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    const current = workerPool.getDiffRenderOptions();
    if (current.theme === themeName) {
      return;
    }

    void workerPool
      .setRenderOptions({
        ...current,
        theme: themeName,
      })
      .catch(() => undefined);
  }, [themeName, workerPool]);

  return null;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        // At 10,000+ messages a 240-entry AST cache thrashes heavily.
        // 1,200 covers the hot working set for large threads without
        // significantly increasing worker memory pressure.
        totalASTLRUCacheSize: 1_200,
      }}
      highlighterOptions={{
        theme: diffThemeName,
        tokenizeMaxLineLength: 1_000,
      }}
    >
      <DiffWorkerThemeSync themeName={diffThemeName} />
      {children}
    </WorkerPoolContextProvider>
  );
}
