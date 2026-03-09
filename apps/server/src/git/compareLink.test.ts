import { describe, expect, it } from "vitest";

import {
  buildPullRequestCompareUrl,
  parseGitHubRemoteUrl,
  resolvePullRequestCompareContext,
  resolvePullRequestCompareFallback,
} from "./compareLink";

describe("parseGitHubRemoteUrl", () => {
  it("parses GitHub HTTPS remotes", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitHub SSH remotes", () => {
    expect(parseGitHubRemoteUrl("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });
});

describe("resolvePullRequestCompareContext", () => {
  it("resolves same-repo compare context", () => {
    expect(
      resolvePullRequestCompareContext({
        originUrl: "https://github.com/pingdotgg/t3code.git",
        upstreamUrl: null,
        headRemoteUrl: "https://github.com/pingdotgg/t3code.git",
      }),
    ).toEqual({
      baseRepo: { owner: "pingdotgg", repo: "t3code" },
      headRepoOwner: "pingdotgg",
    });
  });

  it("resolves fork compare context against upstream", () => {
    expect(
      resolvePullRequestCompareContext({
        originUrl: "git@github.com:notkainoa/t3code.git",
        upstreamUrl: "git@github.com:pingdotgg/t3code.git",
        headRemoteUrl: "git@github.com:notkainoa/t3code.git",
      }),
    ).toEqual({
      baseRepo: { owner: "pingdotgg", repo: "t3code" },
      headRepoOwner: "notkainoa",
    });
  });

  it("omits compare context for non-GitHub remotes", () => {
    expect(
      resolvePullRequestCompareContext({
        originUrl: "git@gitlab.com:notkainoa/t3code.git",
        upstreamUrl: "git@github.com:pingdotgg/t3code.git",
        headRemoteUrl: "git@gitlab.com:notkainoa/t3code.git",
      }),
    ).toBeNull();
  });
});

describe("resolvePullRequestCompareFallback", () => {
  it("includes title and body when the URL stays within the safety limit", () => {
    const fallback = resolvePullRequestCompareFallback({
      originUrl: "https://github.com/notkainoa/t3code.git",
      upstreamUrl: "https://github.com/pingdotgg/t3code.git",
      headRemoteUrl: "https://github.com/notkainoa/t3code.git",
      baseBranch: "main",
      headBranch: "feature/rename-open-pr-label",
      title: "Rename open PR label",
      body: "Summary\n\n- add fallback",
    });

    expect(fallback).toMatchObject({
      baseBranch: "main",
      headBranch: "feature/rename-open-pr-label",
      baseRepo: "pingdotgg/t3code",
      headRepoOwner: "notkainoa",
    });

    const compareUrl = new URL(fallback!.compareUrl);
    expect(compareUrl.searchParams.get("quick_pull")).toBe("1");
    expect(compareUrl.searchParams.get("title")).toBe("Rename open PR label");
    expect(compareUrl.searchParams.get("body")).toBe("Summary\n\n- add fallback");
  });

  it("omits body when the encoded URL would exceed the safety limit", () => {
    const compareUrl = buildPullRequestCompareUrl({
      baseRepo: { owner: "pingdotgg", repo: "t3code" },
      headRepoOwner: "notkainoa",
      baseBranch: "main",
      headBranch: "feature/rename-open-pr-label",
      title: "Rename open PR label",
      body: "x".repeat(10_000),
    });

    const parsed = new URL(compareUrl);
    expect(parsed.searchParams.get("title")).toBe("Rename open PR label");
    expect(parsed.searchParams.get("body")).toBeNull();
  });
});
