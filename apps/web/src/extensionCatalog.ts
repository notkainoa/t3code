import type {
  ExtensionCatalogItem as SharedExtensionCatalogItem,
  ExtensionKind as SharedExtensionKind,
  ExtensionProvider as SharedExtensionProvider,
  ServerGetExtensionCatalogInput,
} from "@t3tools/contracts";

import { ensureLocalApi } from "./localApi";

export type ExtensionCatalogItem = SharedExtensionCatalogItem;
export type ExtensionKind = SharedExtensionKind;
export type ExtensionProvider = Exclude<SharedExtensionProvider, "shared">;
export type ExtensionTone = "amber" | "blue" | "emerald" | "rose" | "violet" | "slate" | "sky";

const EXTENSION_TONES: readonly ExtensionTone[] = [
  "amber",
  "blue",
  "emerald",
  "rose",
  "violet",
  "slate",
  "sky",
];

const extensionCatalogRequestCache = new Map<string, Promise<readonly ExtensionCatalogItem[]>>();

function normalizeCatalogRequest(
  input: Pick<ServerGetExtensionCatalogInput, "kind" | "provider" | "query">,
): ServerGetExtensionCatalogInput {
  const query = input.query?.trim();
  return {
    kind: input.kind,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(query ? { query } : {}),
  };
}

export function getExtensionCatalogCategories(
  items: readonly ExtensionCatalogItem[],
): readonly string[] {
  return [...new Set(items.map((item) => item.category))];
}

export function resolveExtensionTone(item: ExtensionCatalogItem): ExtensionTone {
  const seed = `${item.id}:${item.provider}:${item.category}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return EXTENSION_TONES[hash % EXTENSION_TONES.length]!;
}

export async function fetchExtensionCatalog(
  input: Pick<ServerGetExtensionCatalogInput, "kind" | "provider" | "query">,
): Promise<readonly ExtensionCatalogItem[]> {
  const normalized = normalizeCatalogRequest(input);
  const cacheKey = JSON.stringify(normalized);
  const cached = extensionCatalogRequestCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const request = ensureLocalApi()
    .server.getExtensionCatalog(normalized)
    .then((result) => result.items)
    .catch((error) => {
      extensionCatalogRequestCache.delete(cacheKey);
      throw error;
    });

  extensionCatalogRequestCache.set(cacheKey, request);
  return await request;
}
