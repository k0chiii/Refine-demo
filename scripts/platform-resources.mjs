const environment = process.argv[2];
if (!["development", "staging", "production"].includes(environment))
  throw new Error("Specify development/staging/production; this command prints a plan only");
// 本番と staging は新 Cloudflare アカウントのバケット名（wrangler.jsonc と同じ）。development はローカルのエミュレーションだけで使う
const bucket =
  { production: "mf100-refine-assets", staging: "mf100-refine-assets-stg" }[environment] ??
  `mf100-assets-${environment}`;
const queue = `mf100-processing-${environment}`;
console.log(
  [
    `pnpm exec wrangler queues create ${queue}`,
    `pnpm exec wrangler queues create ${queue}-dead`,
    `pnpm exec wrangler r2 bucket notification create ${bucket} --queue ${queue} --event-types object-create --prefix derived/`,
    `pnpm exec wrangler r2 bucket lifecycle add ${bucket} abort-incomplete-uploads "" --abort-multipart-days 7`,
    `pnpm exec wrangler r2 bucket lifecycle add ${bucket} expire-processing-scratch temporary/processing/ --expire-days 7`,
  ].join("\n"),
);
