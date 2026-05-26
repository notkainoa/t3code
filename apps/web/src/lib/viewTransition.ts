type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

function supportsRouteViewTransition(): boolean {
  const documentWithTransition = document as DocumentWithViewTransition;
  if (typeof documentWithTransition.startViewTransition !== "function") {
    return false;
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function startRouteViewTransition(callback: () => void | Promise<void>) {
  const documentWithTransition = document as DocumentWithViewTransition;
  if (!supportsRouteViewTransition() || !documentWithTransition.startViewTransition) {
    return callback();
  }

  try {
    return documentWithTransition.startViewTransition(callback).updateCallbackDone;
  } catch {
    return callback();
  }
}

function viewTransitionIdentPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function projectColumnViewTransitionName(input: {
  environmentId: string;
  projectId: string;
  columnKey: string;
}): string {
  return [
    "project_column",
    viewTransitionIdentPart(input.environmentId),
    viewTransitionIdentPart(input.projectId),
    viewTransitionIdentPart(input.columnKey),
  ].join("_");
}

export function projectThreadViewTransitionName(input: {
  environmentId: string;
  threadId: string;
}): string {
  return [
    "project_thread",
    viewTransitionIdentPart(input.environmentId),
    viewTransitionIdentPart(input.threadId),
  ].join("_");
}
