import { readFileSync, writeFileSync } from "node:fs";
const [component, manifestFile, logFile] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const log = readFileSync(logFile, "utf8");
if (component === "worker") {
  const id = /Current Version ID:\s*([a-f0-9-]{36})/i.exec(log)?.[1];
  if (!id)
    throw new Error(
      "Worker deployment completed without a recognizable version ID; inspect deployment before proceeding",
    );
  manifest.workerVersion = id;
} else if (component === "pages") {
  const url = /https:\/\/[a-z0-9]+\.mf100-refine\.pages\.dev\b/i.exec(log)?.[0];
  if (!url)
    throw new Error("Pages deployment ID unavailable; inspect deployment before proceeding");
  manifest.pagesDeployment = url;
} else throw new Error("Specify worker or pages");
manifest.status = manifest.workerVersion && manifest.pagesDeployment ? "deployed" : "partial";
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
