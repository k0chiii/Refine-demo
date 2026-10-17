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
import type * as approvals from "../approvals.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as checks from "../checks.js";
import type * as comments from "../comments.js";
import type * as comparisons from "../comparisons.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as feedback from "../feedback.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as lib_adapters from "../lib/adapters.js";
import type * as lib_ai_anthropic from "../lib/ai/anthropic.js";
import type * as lib_ai_provider from "../lib/ai/provider.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_nogikuAccess from "../lib/nogikuAccess.js";
import type * as lib_principal from "../lib/principal.js";
import type * as lib_redirect from "../lib/redirect.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_webpush from "../lib/webpush.js";
import type * as me from "../me.js";
import type * as notation from "../notation.js";
import type * as notifications from "../notifications.js";
import type * as proofreading from "../proofreading.js";
import type * as providers_nogiku from "../providers/nogiku.js";
import type * as providers_nogikuMock from "../providers/nogikuMock.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as reviews from "../reviews.js";
import type * as revisions from "../revisions.js";
import type * as seed from "../seed.js";
import type * as social from "../social.js";
import type * as submissions from "../submissions.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";
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
  approvals: typeof approvals;
  artifacts: typeof artifacts;
  auth: typeof auth;
  checks: typeof checks;
  comments: typeof comments;
  comparisons: typeof comparisons;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  feedback: typeof feedback;
  home: typeof home;
  http: typeof http;
  "lib/adapters": typeof lib_adapters;
  "lib/ai/anthropic": typeof lib_ai_anthropic;
  "lib/ai/provider": typeof lib_ai_provider;
  "lib/errors": typeof lib_errors;
  "lib/nogikuAccess": typeof lib_nogikuAccess;
  "lib/principal": typeof lib_principal;
  "lib/redirect": typeof lib_redirect;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/users": typeof lib_users;
  "lib/validators": typeof lib_validators;
  "lib/webpush": typeof lib_webpush;
  me: typeof me;
  notation: typeof notation;
  notifications: typeof notifications;
  proofreading: typeof proofreading;
  "providers/nogiku": typeof providers_nogiku;
  "providers/nogikuMock": typeof providers_nogikuMock;
  push: typeof push;
  pushNode: typeof pushNode;
  reviews: typeof reviews;
  revisions: typeof revisions;
  seed: typeof seed;
  social: typeof social;
  submissions: typeof submissions;
  teams: typeof teams;
  users: typeof users;
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

export declare const components: {};
