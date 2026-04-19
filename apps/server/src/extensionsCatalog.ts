import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionCatalogItem,
  ServerGetExtensionCatalogInput,
  ServerSettings,
} from "@t3tools/contracts";

const SKILLS_SH_BASE_URL = "https://skills.sh";
const DEFAULT_LIMIT = 36;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface SkillsShSearchResult {
  readonly skills?: ReadonlyArray<{
    readonly skillId?: string;
    readonly name?: string;
    readonly installs?: number;
    readonly source?: string;
  }>;
}

interface CodexMarketplace {
  readonly plugins?: ReadonlyArray<{
    readonly name?: string;
    readonly category?: string;
    readonly policy?: {
      readonly installation?: string;
    };
    readonly source?: {
      readonly source?: string;
      readonly path?: string;
    };
  }>;
}

interface CodexPluginManifest {
  readonly name?: string;
  readonly description?: string;
  readonly author?: {
    readonly name?: string;
  };
  readonly homepage?: string;
  readonly repository?: string;
  readonly keywords?: ReadonlyArray<string>;
  readonly interface?: {
    readonly displayName?: string;
    readonly shortDescription?: string;
    readonly longDescription?: string;
    readonly category?: string;
    readonly developerName?: string;
  };
}

interface SkillsShListingEntry {
  readonly source: string;
  readonly skillId: string;
  readonly name: string;
  readonly installs: number;
}

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: Promise<T>;
}

const extensionCatalogCache = new Map<string, CacheEntry<readonly ExtensionCatalogItem[]>>();
const textCache = new Map<string, CacheEntry<string>>();

function withCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  loader: () => Promise<T>,
  ttlMs = CACHE_TTL_MS,
): Promise<T> {
  const existing = cache.get(key);
  const now = Date.now();
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) =>
      segment.length <= 3 && /^[A-Z0-9]+$/.test(segment)
        ? segment
        : segment[0]?.toUpperCase() + segment.slice(1),
    )
    .join(" ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function compactCount(value: number | undefined): string | null {
  if (value === undefined || Number.isNaN(value)) {
    return null;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

function parseCompactCount(value: string): number {
  const normalized = value.trim().toUpperCase();
  if (normalized.endsWith("M")) {
    return Math.round(Number.parseFloat(normalized) * 1_000_000);
  }
  if (normalized.endsWith("K")) {
    return Math.round(Number.parseFloat(normalized) * 1_000);
  }
  return Number.parseInt(normalized.replace(/[^\d]/g, ""), 10);
}

function tokenizeTags(...parts: readonly string[]): string[] {
  return [
    ...new Set(
      parts
        .flatMap((part) => part.toLowerCase().split(/[^a-z0-9]+/g))
        .filter((token) => token.length > 2),
    ),
  ].slice(0, 8);
}

function categorizeEntry(input: { readonly name: string; readonly source: string }): string {
  const tokens = `${input.name} ${input.source}`.toLowerCase();

  if (
    /\b(ui|ux|design|figma|frontend|css|tailwind|react|vue|remotion|slides|banner|brand)\b/.test(
      tokens,
    )
  ) {
    return "Design";
  }
  if (/\b(test|debug|jest|playwright|coverage|lint|review|quality|audit)\b/.test(tokens)) {
    return "Quality";
  }
  if (
    /\b(deploy|cloud|vercel|netlify|cloudflare|aws|docker|infra|kubernetes|render)\b/.test(tokens)
  ) {
    return "Delivery";
  }
  if (
    /\b(plan|project|agent|mcp|plugin|command|hook|workflow|orchestrat|automation)\b/.test(tokens)
  ) {
    return "Workflow";
  }
  if (
    /\b(github|git|database|sql|postgres|auth|api|backend|java|python|node|rust|swift)\b/.test(
      tokens,
    )
  ) {
    return "Coding";
  }

  return "Featured";
}

function matchesQuery(item: ExtensionCatalogItem, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [item.title, item.summary, item.description, item.tags.join(" ")]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function buildSkillsShSourceUrl(source: string, skillId: string): string {
  return `${SKILLS_SH_BASE_URL}/${source}/${skillId}`;
}

function buildSkillsShInstallCommand(source: string, skillId: string): string {
  return `npx skills add ${source} --skill ${skillId}`;
}

function toSkillCatalogItem(input: {
  readonly source: string;
  readonly skillId: string;
  readonly name: string;
  readonly installs: number;
  readonly provider: "shared" | "claudeCode";
  readonly kind: "skill" | "plugin";
  readonly official: boolean;
}): ExtensionCatalogItem {
  const title = titleCase(input.name);
  const count = compactCount(input.installs);
  const category = categorizeEntry({ name: input.skillId, source: input.source });
  const sourceName = input.official ? input.source : `${input.source} on skills.sh`;
  const typeLabel = input.kind === "plugin" ? "extension" : "skill";

  return {
    id: `${input.kind}-${input.provider}-${input.source.replaceAll("/", "-")}-${input.skillId}`,
    kind: input.kind,
    title,
    summary: count
      ? `${title} is a ${typeLabel} from ${sourceName} with ${count} installs.`
      : `${title} is a ${typeLabel} from ${sourceName}.`,
    description: input.official
      ? `${title} comes from ${input.source} and is surfaced through skills.sh for ${input.provider === "claudeCode" ? "Claude Code" : "agent"} workflows.`
      : `${title} is a community-published ${typeLabel} from ${input.source} in the skills.sh ecosystem.`,
    category,
    provider: input.provider,
    sourceLabel: input.official ? "Official skills.sh source" : "skills.sh",
    sourceUrl: buildSkillsShSourceUrl(input.source, input.skillId),
    installCommand: buildSkillsShInstallCommand(input.source, input.skillId),
    tags: tokenizeTags(input.source, input.skillId, input.name, category),
    installs: input.installs,
    official: input.official,
  };
}

function toCodexPluginCatalogItem(input: {
  readonly entry: NonNullable<CodexMarketplace["plugins"]>[number];
  readonly manifest: CodexPluginManifest;
}): ExtensionCatalogItem | null {
  const rawName = input.entry.name?.trim() || input.manifest.name?.trim();
  if (!rawName) {
    return null;
  }

  const title = input.manifest.interface?.displayName?.trim() || titleCase(rawName);
  const summary =
    input.manifest.interface?.shortDescription?.trim() ||
    input.manifest.description?.trim() ||
    `${title} plugin`;
  const description =
    input.manifest.interface?.longDescription?.trim() ||
    input.manifest.description?.trim() ||
    summary;
  const category =
    input.manifest.interface?.category?.trim() || input.entry.category?.trim() || "Other";
  const developerName =
    input.manifest.interface?.developerName?.trim() || input.manifest.author?.name?.trim();
  const sourceLabel = developerName
    ? developerName === "OpenAI"
      ? "Codex official"
      : developerName
    : "Codex marketplace";

  return {
    id: `plugin-codex-${rawName}`,
    kind: "plugin",
    title,
    summary,
    description,
    category,
    provider: "codex",
    sourceLabel,
    sourceUrl: input.manifest.homepage?.trim() || input.manifest.repository?.trim() || null,
    installCommand: null,
    tags: tokenizeTags(rawName, title, category, ...(input.manifest.keywords ?? [])),
    official: developerName === "OpenAI",
  };
}

function parseSkillsHomepage(html: string): SkillsShListingEntry[] {
  const normalized = html.replace(/\\"/g, '"');
  const matches = normalized.matchAll(
    /\{"source":"([^"]+)","skillId":"([^"]+)","name":"([^"]+)","installs":(\d+)\}/g,
  );

  return [...matches].map((match) => ({
    source: match[1]!,
    skillId: match[2]!,
    name: decodeHtmlEntities(match[3]!),
    installs: Number.parseInt(match[4]!, 10),
  }));
}

function parseSkillsRepositoryPage(html: string, source: string): SkillsShListingEntry[] {
  const matches = html.matchAll(
    new RegExp(
      `<a[^>]+href="/${source.replace("/", "\\/")}\\/([^"]+)"[^>]*>[\\s\\S]*?<h3[^>]*>([^<]+)<\\/h3>[\\s\\S]*?<span class="font-mono text-sm text-foreground">([^<]+)<\\/span>`,
      "g",
    ),
  );

  return [...matches].map((match) => ({
    source,
    skillId: decodeHtmlEntities(match[1]!),
    name: decodeHtmlEntities(match[2]!),
    installs: parseCompactCount(match[3]!),
  }));
}

async function fetchText(url: string): Promise<string> {
  return withCache(textCache, url, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/json",
        "User-Agent": "t3code-extension-catalog/0.1",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed for ${url}: ${response.status}`);
    }

    return await response.text();
  });
}

async function readSkillsShTopSkills(
  limit: number,
  query: string,
): Promise<readonly ExtensionCatalogItem[]> {
  const html = await fetchText(SKILLS_SH_BASE_URL);
  return parseSkillsHomepage(html)
    .slice(0, Math.max(limit * 4, limit))
    .map((entry) =>
      toSkillCatalogItem({
        ...entry,
        provider: "shared",
        kind: "skill",
        official: entry.source.startsWith("anthropics/") || entry.source.startsWith("openai/"),
      }),
    )
    .filter((item) => matchesQuery(item, query))
    .slice(0, limit);
}

async function readSkillsShSearch(
  query: string,
  limit: number,
): Promise<readonly ExtensionCatalogItem[]> {
  const url = `${SKILLS_SH_BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const raw = await fetchText(url);
  const payload = JSON.parse(raw) as SkillsShSearchResult;

  return (payload.skills ?? []).flatMap((entry) => {
    const source = entry.source?.trim();
    const skillId = entry.skillId?.trim();
    const name = entry.name?.trim();
    const installs = typeof entry.installs === "number" ? entry.installs : 0;
    if (!source || !skillId || !name) {
      return [];
    }

    return [
      toSkillCatalogItem({
        source,
        skillId,
        name,
        installs,
        provider: "shared",
        kind: "skill",
        official: source.startsWith("anthropics/") || source.startsWith("openai/"),
      }),
    ];
  });
}

async function readClaudeCodeCatalog(
  limit: number,
  query: string,
): Promise<readonly ExtensionCatalogItem[]> {
  const html = await fetchText(`${SKILLS_SH_BASE_URL}/anthropics/claude-code`);
  return parseSkillsRepositoryPage(html, "anthropics/claude-code")
    .map((entry) =>
      toSkillCatalogItem({
        ...entry,
        provider: "claudeCode",
        kind: "plugin",
        official: true,
      }),
    )
    .filter((item) => matchesQuery(item, query))
    .slice(0, limit);
}

async function findCodexMarketplacePath(homePath: string): Promise<string | null> {
  const directPath = path.join(
    homePath,
    ".tmp",
    "plugins",
    ".agents",
    "plugins",
    "marketplace.json",
  );
  try {
    await fs.access(directPath);
    return directPath;
  } catch {
    // Fall through to clone candidates.
  }

  const tmpDir = path.join(homePath, ".tmp");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(tmpDir);
  } catch {
    return null;
  }

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.startsWith("plugins-clone-"))
      .map(async (entry) => {
        const candidatePath = path.join(tmpDir, entry, ".agents", "plugins", "marketplace.json");
        try {
          const stats = await fs.stat(candidatePath);
          return { candidatePath, mtimeMs: stats.mtimeMs };
        } catch {
          return null;
        }
      }),
  );

  return (
    candidates
      .flatMap((candidate) => (candidate ? [candidate] : []))
      .toSorted((left, right) => right.mtimeMs - left.mtimeMs)[0]?.candidatePath ?? null
  );
}

function resolveCodexHomePath(settings: ServerSettings): string {
  const configured = settings.providers.codex.homePath.trim();
  if (configured.length > 0) {
    return configured;
  }

  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

async function readCodexCatalog(
  settings: ServerSettings,
  query: string,
): Promise<readonly ExtensionCatalogItem[]> {
  const homePath = resolveCodexHomePath(settings);
  const marketplacePath = await findCodexMarketplacePath(homePath);
  if (!marketplacePath) {
    return [];
  }

  const rootDir = path.resolve(path.dirname(marketplacePath), "..", "..");
  const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8")) as CodexMarketplace;
  const items = await Promise.all(
    (marketplace.plugins ?? []).flatMap((entry) => {
      if (entry.policy?.installation && entry.policy.installation !== "AVAILABLE") {
        return [];
      }
      if (entry.source?.source !== "local" || !entry.source.path) {
        return [];
      }

      const manifestPath = path.resolve(rootDir, entry.source.path, ".codex-plugin", "plugin.json");
      return [
        fs
          .readFile(manifestPath, "utf8")
          .then((raw) => JSON.parse(raw) as CodexPluginManifest)
          .then((manifest) => toCodexPluginCatalogItem({ entry, manifest }))
          .catch(() => null),
      ];
    }),
  );

  return items.flatMap((item) => (item ? [item] : [])).filter((item) => matchesQuery(item, query));
}

export async function loadExtensionCatalog(
  input: ServerGetExtensionCatalogInput,
  settings: ServerSettings,
): Promise<readonly ExtensionCatalogItem[]> {
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.min(Math.floor(input.limit!), 80))
    : DEFAULT_LIMIT;
  const query = input.query?.trim().toLowerCase() ?? "";
  const cacheKey = JSON.stringify({
    kind: input.kind,
    provider: input.provider ?? null,
    query,
    limit,
    codexHomePath: settings.providers.codex.homePath.trim(),
  });

  return withCache(extensionCatalogCache, cacheKey, async () => {
    if (input.kind === "skill") {
      if (query.length >= 2) {
        return await readSkillsShSearch(query, limit);
      }
      return await readSkillsShTopSkills(limit, query);
    }

    if (input.provider === "claudeCode") {
      return await readClaudeCodeCatalog(limit, query);
    }

    return (await readCodexCatalog(settings, query)).slice(0, limit);
  });
}

export const __internal = {
  categorizeEntry,
  parseSkillsHomepage,
  parseSkillsRepositoryPage,
  parseCompactCount,
  resolveCodexHomePath,
  titleCase,
};
