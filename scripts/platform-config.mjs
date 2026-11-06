import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.argv[2];
if (!["development", "staging", "production"].includes(environment))
  throw new Error(
    "Usage: node scripts/platform-config.mjs <development|staging|production> [ai,processing,assets]",
  );
const features = new Set((process.argv[3] ?? "ai,processing,assets").split(","));
for (const feature of features)
  if (!["ai", "processing", "assets"].includes(feature))
    throw new Error(`Unknown feature: ${feature}`);
const source = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  fs.readFileSync(path.join(root, "apps/api/wrangler.jsonc"), "utf8"),
);
if (source.error) throw new Error("Cannot parse Wrangler configuration");
const config = source.config;
const selected = environment === "development" ? {} : config.env[environment];
const result = { ...config, ...selected, main: "src/index.ts" };
delete result.env;
if (features.has("ai")) result.ai = { binding: "AI", remote: true };
if (features.has("assets"))
  result.assets = {
    binding: "STATIC_ASSETS",
    directory: "../web/dist",
    not_found_handling: "single-page-application",
    run_worker_first: true,
  };
if (features.has("processing")) {
  result.main = "src/platform.ts";
  const queue = `mf100-processing-${environment}`;
  result.queues = {
    producers: [{ binding: "PROCESSING_QUEUE", queue }],
    consumers: [
      {
        queue,
        max_batch_size: 1,
        max_concurrency: 2,
        max_retries: 3,
        dead_letter_queue: `${queue}-dead`,
      },
    ],
  };
  result.workflows = [
    { binding: "FILE_WORKFLOW", name: `mf100-files-${environment}`, class_name: "FileWorkflow" },
  ];
  result.images = { binding: "IMAGES" };
  result.media = { binding: "MEDIA" };
  result.browser = { binding: "BROWSER" };
  result.durable_objects = { bindings: [{ name: "CONVERTER", class_name: "PreviewContainer" }] };
  result.migrations = [{ tag: "preview-container-v1", new_sqlite_classes: ["PreviewContainer"] }];
  result.containers = [
    {
      class_name: "PreviewContainer",
      image: "./container/Dockerfile",
      max_instances: 2,
      instance_type: "standard-1",
    },
  ];
}
const output = path.join(root, "apps/api/wrangler.platform.generated.json");
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  `Prepared ${path.relative(root, output)} (${environment}; ${[...features].join(", ")}). No resources created or deployed.`,
);
