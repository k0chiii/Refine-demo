/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as acl from "../acl.js";
import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as aiWorkflow from "../aiWorkflow.js";
import type * as approvals from "../approvals.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as checks from "../checks.js";
import type * as collaboration from "../collaboration.js";
import type * as commentFiles from "../commentFiles.js";
import type * as comments from "../comments.js";
import type * as comparisons from "../comparisons.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as delivery from "../delivery.js";
import type * as deliveryNode from "../deliveryNode.js";
import type * as documents from "../documents.js";
import type * as feedbackMigration from "../feedbackMigration.js";
import type * as groups from "../groups.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as lib_adapters from "../lib/adapters.js";
import type * as lib_ai_anthropic from "../lib/ai/anthropic.js";
import type * as lib_ai_gateway from "../lib/ai/gateway.js";
import type * as lib_ai_provider from "../lib/ai/provider.js";
import type * as lib_ai_workersAi from "../lib/ai/workersAi.js";
import type * as lib_authEnv from "../lib/authEnv.js";
import type * as lib_channels from "../lib/channels.js";
import type * as lib_deliveryPool from "../lib/deliveryPool.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_nogikuAccess from "../lib/nogikuAccess.js";
import type * as lib_notationSamples from "../lib/notationSamples.js";
import type * as lib_principal from "../lib/principal.js";
import type * as lib_processingValidators from "../lib/processingValidators.js";
import type * as lib_reactions from "../lib/reactions.js";
import type * as lib_redirect from "../lib/redirect.js";
import type * as lib_retryAfter from "../lib/retryAfter.js";
import type * as lib_revisionThreadStats from "../lib/revisionThreadStats.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_slack from "../lib/slack.js";
import type * as lib_threadActivity from "../lib/threadActivity.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_webpush from "../lib/webpush.js";
import type * as lib_workAggregate from "../lib/workAggregate.js";
import type * as lib_workSearch from "../lib/workSearch.js";
import type * as lib_workSummary from "../lib/workSummary.js";
import type * as me from "../me.js";
import type * as migrations from "../migrations.js";
import type * as migrations_decision104 from "../migrations/decision104.js";
import type * as notation from "../notation.js";
import type * as notationSeed from "../notationSeed.js";
import type * as notificationPrefs from "../notificationPrefs.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as processing from "../processing.js";
import type * as proofreading from "../proofreading.js";
import type * as providers_nogiku from "../providers/nogiku.js";
import type * as providers_nogikuMock from "../providers/nogikuMock.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as reviews from "../reviews.js";
import type * as revisions from "../revisions.js";
import type * as seed from "../seed.js";
import type * as semanticRules from "../semanticRules.js";
import type * as slackWorkspaces from "../slackWorkspaces.js";
import type * as social from "../social.js";
import type * as submissions from "../submissions.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";
import type * as workMetrics from "../workMetrics.js";
import type * as works from "../works.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  acl: typeof acl;
  admin: typeof admin;
  ai: typeof ai;
  aiWorkflow: typeof aiWorkflow;
  approvals: typeof approvals;
  artifacts: typeof artifacts;
  auth: typeof auth;
  checks: typeof checks;
  collaboration: typeof collaboration;
  commentFiles: typeof commentFiles;
  comments: typeof comments;
  comparisons: typeof comparisons;
  crons: typeof crons;
  dashboard: typeof dashboard;
  delivery: typeof delivery;
  deliveryNode: typeof deliveryNode;
  documents: typeof documents;
  feedbackMigration: typeof feedbackMigration;
  groups: typeof groups;
  home: typeof home;
  http: typeof http;
  "lib/adapters": typeof lib_adapters;
  "lib/ai/anthropic": typeof lib_ai_anthropic;
  "lib/ai/gateway": typeof lib_ai_gateway;
  "lib/ai/provider": typeof lib_ai_provider;
  "lib/ai/workersAi": typeof lib_ai_workersAi;
  "lib/authEnv": typeof lib_authEnv;
  "lib/channels": typeof lib_channels;
  "lib/deliveryPool": typeof lib_deliveryPool;
  "lib/email": typeof lib_email;
  "lib/errors": typeof lib_errors;
  "lib/nogikuAccess": typeof lib_nogikuAccess;
  "lib/notationSamples": typeof lib_notationSamples;
  "lib/principal": typeof lib_principal;
  "lib/processingValidators": typeof lib_processingValidators;
  "lib/reactions": typeof lib_reactions;
  "lib/redirect": typeof lib_redirect;
  "lib/retryAfter": typeof lib_retryAfter;
  "lib/revisionThreadStats": typeof lib_revisionThreadStats;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/slack": typeof lib_slack;
  "lib/threadActivity": typeof lib_threadActivity;
  "lib/users": typeof lib_users;
  "lib/validators": typeof lib_validators;
  "lib/webpush": typeof lib_webpush;
  "lib/workAggregate": typeof lib_workAggregate;
  "lib/workSearch": typeof lib_workSearch;
  "lib/workSummary": typeof lib_workSummary;
  me: typeof me;
  migrations: typeof migrations;
  "migrations/decision104": typeof migrations_decision104;
  notation: typeof notation;
  notationSeed: typeof notationSeed;
  notificationPrefs: typeof notificationPrefs;
  notifications: typeof notifications;
  presence: typeof presence;
  processing: typeof processing;
  proofreading: typeof proofreading;
  "providers/nogiku": typeof providers_nogiku;
  "providers/nogikuMock": typeof providers_nogikuMock;
  push: typeof push;
  pushNode: typeof pushNode;
  reviews: typeof reviews;
  revisions: typeof revisions;
  seed: typeof seed;
  semanticRules: typeof semanticRules;
  slackWorkspaces: typeof slackWorkspaces;
  social: typeof social;
  submissions: typeof submissions;
  teams: typeof teams;
  users: typeof users;
  workMetrics: typeof workMetrics;
  works: typeof works;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  pushPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"pushPool">;
};
