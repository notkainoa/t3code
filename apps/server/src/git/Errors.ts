import type { GitPullRequestCreateCompareFallbackErrorData } from "@t3tools/contracts";
import { GIT_PR_CREATE_COMPARE_FALLBACK_ERROR_CODE } from "@t3tools/contracts";
import { Schema } from "effect";

/**
 * GitCommandError - Git command execution failed.
 */
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
  operation: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git command failed in ${this.operation}: ${this.command} (${this.cwd}) - ${this.detail}`;
  }
}

/**
 * GitHubCliError - GitHub CLI execution or authentication failed.
 */
export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()("GitHubCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * TextGenerationError - Commit or PR text generation failed.
 */
export class TextGenerationError extends Schema.TaggedErrorClass<TextGenerationError>()(
  "TextGenerationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * GitManagerError - Stacked Git workflow orchestration failed.
 */
export class GitManagerError extends Schema.TaggedErrorClass<GitManagerError>()("GitManagerError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git manager failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitPullRequestCreateCompareFallbackError extends Error {
  override readonly name = "GitPullRequestCreateCompareFallbackError";
  readonly code = GIT_PR_CREATE_COMPARE_FALLBACK_ERROR_CODE;
  readonly data: GitPullRequestCreateCompareFallbackErrorData;
  readonly operation: string;
  override readonly cause: unknown;

  constructor(input: {
    operation: string;
    message: string;
    data: GitPullRequestCreateCompareFallbackErrorData;
    cause?: unknown;
  }) {
    super(input.message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.operation = input.operation;
    this.data = input.data;
    this.cause = input.cause;
  }
}

/**
 * GitManagerServiceError - Errors emitted by stacked Git workflow orchestration.
 */
export type GitManagerServiceError =
  | GitManagerError
  | GitCommandError
  | GitHubCliError
  | GitPullRequestCreateCompareFallbackError
  | TextGenerationError;
