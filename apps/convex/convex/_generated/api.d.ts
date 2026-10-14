/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev` (or `pnpm codegen` for offline generation).
 * @module
 */

import type * as acl from "../acl.js";
import type * as admin from "../admin.js";
import type * as approvals from "../approvals.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as checks from "../checks.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as me from "../me.js";
import type * as notifications from "../notifications.js";
import type * as reviews from "../reviews.js";
import type * as revisions from "../revisions.js";
import type * as seed from "../seed.js";
import type * as submissions from "../submissions.js";
import type * as users from "../users.js";
import type * as works from "../works.js";
import type { ApiFromModules, FilterApi, FunctionReference, AnyComponents } from "convex/server";

declare const fullApi: ApiFromModules<{
  acl: typeof acl;
  admin: typeof admin;
  approvals: typeof approvals;
  artifacts: typeof artifacts;
  auth: typeof auth;
  checks: typeof checks;
  comments: typeof comments;
  crons: typeof crons;
  dashboard: typeof dashboard;
  documents: typeof documents;
  http: typeof http;
  me: typeof me;
  notifications: typeof notifications;
  reviews: typeof reviews;
  revisions: typeof revisions;
  seed: typeof seed;
  submissions: typeof submissions;
  users: typeof users;
  works: typeof works;
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
