import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  gitMutationKeys,
  gitQueryKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  gitResolveWorktreeBaseSourceQueryOptions,
  gitRunStackedActionMutationOptions,
} from "./gitReactQuery";

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction("/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction("/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull("/repo/a")).not.toEqual(gitMutationKeys.pull("/repo/b"));
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread("/repo/a")).not.toEqual(
      gitMutationKeys.preparePullRequestThread("/repo/b"),
    );
  });

  it("scopes worktree base source keys by cwd and branch", () => {
    expect(gitQueryKeys.worktreeBaseSource("/repo/a", "main")).not.toEqual(
      gitQueryKeys.worktreeBaseSource("/repo/b", "main"),
    );
    expect(gitQueryKeys.worktreeBaseSource("/repo/a", "main")).not.toEqual(
      gitQueryKeys.worktreeBaseSource("/repo/a", "feature/demo"),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction("/repo/a"));
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull("/repo/a"));
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.preparePullRequestThread("/repo/a"));
  });

  it("attaches cwd-and-branch scoped query key for resolveWorktreeBaseSource", () => {
    const options = gitResolveWorktreeBaseSourceQueryOptions({
      cwd: "/repo/a",
      branch: "main",
    });
    expect(options.queryKey).toEqual(gitQueryKeys.worktreeBaseSource("/repo/a", "main"));
  });
});
