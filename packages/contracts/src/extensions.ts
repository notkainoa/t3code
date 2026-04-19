import { Effect, Schema } from "effect";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ExtensionKind = Schema.Literals(["plugin", "skill"]);
export type ExtensionKind = typeof ExtensionKind.Type;

export const ExtensionProvider = Schema.Literals(["codex", "claudeCode", "shared"]);
export type ExtensionProvider = typeof ExtensionProvider.Type;

export const ExtensionCatalogItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ExtensionKind,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  category: TrimmedNonEmptyString,
  provider: ExtensionProvider,
  sourceLabel: TrimmedNonEmptyString,
  sourceUrl: Schema.NullOr(TrimmedNonEmptyString),
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  tags: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  installs: Schema.optional(NonNegativeInt),
  official: Schema.optional(Schema.Boolean),
});
export type ExtensionCatalogItem = typeof ExtensionCatalogItem.Type;

export const ServerGetExtensionCatalogInput = Schema.Struct({
  kind: ExtensionKind,
  provider: Schema.optionalKey(Schema.Literals(["codex", "claudeCode"])),
  query: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Number),
});
export type ServerGetExtensionCatalogInput = typeof ServerGetExtensionCatalogInput.Type;

export const ServerGetExtensionCatalogResult = Schema.Struct({
  items: Schema.Array(ExtensionCatalogItem),
});
export type ServerGetExtensionCatalogResult = typeof ServerGetExtensionCatalogResult.Type;

export class ServerExtensionCatalogError extends Schema.TaggedErrorClass<ServerExtensionCatalogError>()(
  "ServerExtensionCatalogError",
  {
    message: TrimmedNonEmptyString,
  },
) {}
