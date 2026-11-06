import { spawnSync } from "node:child_process";
const environment = process.argv[2];
if (!["staging", "production"].includes(environment)) {
  console.error(
    "Specify staging or production: pnpm deploy <environment>. Configure isolated resources first.",
  );
  process.exit(1);
}
const variables = [];
if (environment === "staging") {
  const cloud = process.env.STAGING_CONVEX_URL;
  const site = process.env.STAGING_CONVEX_SITE_URL;
  const origins = process.env.STAGING_ALLOWED_ORIGINS;
  if (!cloud || !site || !origins)
    throw new Error(
      "Set STAGING_CONVEX_URL, STAGING_CONVEX_SITE_URL and STAGING_ALLOWED_ORIGINS first",
    );
  const deployment = new URL(cloud);
  if (
    deployment.protocol !== "https:" ||
    !deployment.hostname.endsWith(".convex.cloud") ||
    deployment.hostname === "rosy-egret-142.convex.cloud"
  )
    throw new Error("Staging must use an isolated Convex deployment");
  if (site !== cloud.replace(/\.convex\.cloud\/?$/, ".convex.site"))
    throw new Error("Staging cloud and site URLs must belong to the same deployment");
  for (const origin of origins.split(",")) {
    const parsed = new URL(origin.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.origin === "https://mf100-refine.pages.dev" ||
      parsed.origin !== origin.trim()
    )
      throw new Error("Staging requires isolated HTTPS frontend origins");
  }
  for (const [name, value] of Object.entries({
    CONVEX_URL: cloud,
    CONVEX_SITE_URL: site,
    ALLOWED_ORIGINS: origins,
  }))
    variables.push("--var", `${name}:${value}`);
}
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.jsonc",
    "--env",
    environment,
    ...variables,
    ...process.argv.slice(3),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
