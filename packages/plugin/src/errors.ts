import { Data } from "effect";

export class RepoDiscoveryError extends Data.TaggedError("RepoDiscoveryError")<{
  readonly rootDir: string;
  readonly message: string;
}> {}

export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
  readonly subject: string;
  readonly message: string;
}> {}

export class SqliteIndexError extends Data.TaggedError("SqliteIndexError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class GitCommandError extends Data.TaggedError("GitCommandError")<{
  readonly args: readonly string[];
  readonly cwd: string;
  readonly message: string;
}> {}

export class StudioServerError extends Data.TaggedError("StudioServerError")<{
  readonly message: string;
  readonly status?: number;
}> {}

export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly message: string;
}> {}
