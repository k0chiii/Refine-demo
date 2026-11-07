import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { callFunction } from "./cloudflareGateway.ts";

export type ProcessingCreateArgs = FunctionArgs<typeof api.processing.create>;
export type ProcessingJobView = FunctionReturnType<typeof api.processing.get>;

/**
 * 利用者として処理の依頼・進み具合を引く（platform.ts の /processing/*）。
 * 公開 query が閲覧者の現在の ACL を毎回確かめるので、ここでは利用者の JWT をそのまま渡すだけ。
 */
export interface ProcessingClient {
  create(args: ProcessingCreateArgs): Promise<string>;
  get(jobId: string): Promise<ProcessingJobView>;
}

export function createConvexProcessingClient(convexUrl: string, token: string): ProcessingClient {
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return {
    create: (args) => client.mutation(api.processing.create, args),
    get: (jobId) => client.query(api.processing.get, { jobId: jobId as Id<"processingJobs"> }),
  };
}

export function createCloudflareProcessingClient(siteUrl: string, token: string): ProcessingClient {
  const headers = { Authorization: `Bearer ${token}` };
  return {
    // Id<"processingJobs"> は Cloudflare では ただの文字列
    create: (args) => callFunction<string>(siteUrl, "processing:create", headers, args),
    // ponytail: Cloudflare の get の戻りは Convex 版と形が違い得る（id / output / state / error）。使うのは state と output だけなので型は Convex に寄せて cast
    get: (jobId) => callFunction<ProcessingJobView>(siteUrl, "processing:get", headers, { jobId }),
  };
}
