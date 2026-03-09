function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(String(key)) ?? null;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
  };
}

export function installTestWindowWithLocalStorage(): Storage {
  const storage = createMemoryStorage();
  const existingWindow = globalThis.window;
  const addEventListener =
    existingWindow?.addEventListener?.bind(existingWindow) ?? (() => undefined);
  const removeEventListener =
    existingWindow?.removeEventListener?.bind(existingWindow) ?? (() => undefined);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener,
      removeEventListener,
    },
  });

  return storage;
}

export const testLocalStorage = installTestWindowWithLocalStorage();
