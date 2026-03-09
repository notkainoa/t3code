import type { GitPullRequestCreateCompareFallbackErrorData } from "@t3tools/contracts";

const GITHUB_HOSTNAME = "github.com";
const COMPARE_URL_BODY_MAX_LENGTH = 7_000;

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface ResolvePullRequestCompareLinkInput {
  originUrl: string | null;
  upstreamUrl: string | null;
  headRemoteUrl: string | null;
  baseBranch: string;
  headBranch: string;
  title?: string | undefined;
  body?: string | undefined;
}

function trimTrailingGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "").replace(/\/+$/g, "");
}

export function parseGitHubRemoteUrl(remoteUrl: string): GitHubRepoRef | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sshMatch[1]?.trim();
    const repo = sshMatch[2]?.trim();
    if (owner && repo) {
      return { owner, repo };
    }
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshUrlMatch) {
    const owner = sshUrlMatch[1]?.trim();
    const repo = sshUrlMatch[2]?.trim();
    if (owner && repo) {
      return { owner, repo };
    }
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== GITHUB_HOSTNAME) {
      return null;
    }
    const segments = trimTrailingGitSuffix(parsed.pathname)
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      return null;
    }
    const [owner, repo] = segments;
    if (!owner || !repo) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

export function resolvePullRequestCompareContext(input: {
  originUrl: string | null;
  upstreamUrl: string | null;
  headRemoteUrl: string | null;
}): { baseRepo: GitHubRepoRef; headRepoOwner: string } | null {
  const headRepo = input.headRemoteUrl ? parseGitHubRemoteUrl(input.headRemoteUrl) : null;
  if (!headRepo) {
    return null;
  }

  const originRepo = input.originUrl ? parseGitHubRemoteUrl(input.originUrl) : null;
  const upstreamRepo = input.upstreamUrl ? parseGitHubRemoteUrl(input.upstreamUrl) : null;
  const fallbackBaseRepo = originRepo ?? headRepo;
  const baseRepo =
    upstreamRepo &&
    (upstreamRepo.owner !== headRepo.owner || upstreamRepo.repo !== headRepo.repo)
      ? upstreamRepo
      : fallbackBaseRepo;

  return {
    baseRepo,
    headRepoOwner: headRepo.owner,
  };
}

function toRepoSlug(repo: GitHubRepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function createCompareUrlBase(input: {
  baseRepo: GitHubRepoRef;
  headRepoOwner: string;
  baseBranch: string;
  headBranch: string;
}): URL {
  const pathname = [
    "",
    encodeURIComponent(input.baseRepo.owner),
    encodeURIComponent(input.baseRepo.repo),
    "compare",
    `${encodeURIComponent(input.baseBranch)}...${encodeURIComponent(input.headRepoOwner)}:${encodeURIComponent(input.headBranch)}`,
  ].join("/");
  const url = new URL(`https://${GITHUB_HOSTNAME}${pathname}`);
  url.searchParams.set("quick_pull", "1");
  return url;
}

export function buildPullRequestCompareUrl(input: {
  baseRepo: GitHubRepoRef;
  headRepoOwner: string;
  baseBranch: string;
  headBranch: string;
  title?: string | undefined;
  body?: string | undefined;
}): string {
  const url = createCompareUrlBase(input);
  const title = input.title?.trim();
  if (title) {
    url.searchParams.set("title", title);
  }

  const body = input.body?.trim();
  if (body) {
    const withBody = new URL(url.toString());
    withBody.searchParams.set("body", body);
    if (withBody.toString().length <= COMPARE_URL_BODY_MAX_LENGTH) {
      url.searchParams.set("body", body);
    }
  }

  return url.toString();
}

export function resolvePullRequestCompareFallback(
  input: ResolvePullRequestCompareLinkInput,
): GitPullRequestCreateCompareFallbackErrorData | null {
  const context = resolvePullRequestCompareContext(input);
  if (!context) {
    return null;
  }

  return {
    compareUrl: buildPullRequestCompareUrl({
      baseRepo: context.baseRepo,
      headRepoOwner: context.headRepoOwner,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      title: input.title,
      body: input.body,
    }),
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    baseRepo: toRepoSlug(context.baseRepo),
    headRepoOwner: context.headRepoOwner,
  };
}
