#!/usr/bin/env node
/**
 * `convex/_generated` のオフライン生成。
 *
 * 公式の `npx convex codegen` は dev deployment（ログイン or CONVEX_DEPLOY_KEY）を要求するため、
 * CI やデプロイメント未設定の環境で型チェック・convex-test を走らせるために同じ内容をローカル生成する。
 * 出力は Convex 1.46 が生成するテンプレートと同一形式（api/server/dataModel）。
 * `npx convex dev` を実行すると公式生成物で上書きされるが、内容は等価。
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "convex");
const out = join(root, "_generated");
mkdirSync(out, { recursive: true });

const EXCLUDE = new Set(["schema.ts", "auth.config.ts", "convex.config.ts"]);
const modules = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".test.ts") && !d.name.endsWith(".d.ts") && !EXCLUDE.has(d.name))
  .map((d) => d.name.replace(/\.ts$/, ""))
  .sort();

const header = (what) => `/* eslint-disable */
/**
 * ${what}
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run \`npx convex dev\` (or \`pnpm codegen\` for offline generation).
 * @module
 */
`;

writeFileSync(
  join(out, "api.d.ts"),
  `${header("Generated `api` utility.")}
${modules.map((m) => `import type * as ${m} from "../${m}.js";`).join("\n")}
import type { ApiFromModules, FilterApi, FunctionReference, AnyComponents } from "convex/server";

declare const fullApi: ApiFromModules<{
${modules.map((m) => `  ${m}: typeof ${m};`).join("\n")}
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: AnyComponents;
`,
);

writeFileSync(
  join(out, "api.js"),
  `${header("Generated `api` utility.")}
import { anyApi, componentsGeneric } from "convex/server";

export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
`,
);

writeFileSync(
  join(out, "server.js"),
  `${header("Generated utilities for implementing server-side Convex query and mutation functions.")}
import {
  actionGeneric,
  httpActionGeneric,
  queryGeneric,
  mutationGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";

export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;
export const env = process.env;
`,
);

writeFileSync(
  join(out, "server.d.ts"),
  `${header("Generated utilities for implementing server-side Convex query and mutation functions.")}
import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

export declare const query: QueryBuilder<DataModel, "public">;
export declare const internalQuery: QueryBuilder<DataModel, "internal">;
export declare const mutation: MutationBuilder<DataModel, "public">;
export declare const internalMutation: MutationBuilder<DataModel, "internal">;
export declare const action: ActionBuilder<DataModel, "public">;
export declare const internalAction: ActionBuilder<DataModel, "internal">;
export declare const httpAction: HttpActionBuilder;
export declare const env: Record<string, string | undefined>;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;
export type DatabaseReader = GenericDatabaseReader<DataModel>;
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
`,
);

writeFileSync(
  join(out, "dataModel.d.ts"),
  `${header("Generated data model types.")}
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`,
);

console.log(`generated convex/_generated for modules: ${modules.join(", ")}`);
