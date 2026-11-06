import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const environment = process.argv[2];
if (!["staging", "production"].includes(environment))
  throw new Error("Specify staging or production");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const directory = process.argv[3] ?? ".logs/releases";
mkdirSync(directory, { recursive: true });
const file = join(directory, `${environment}-${commit}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      commit,
      environment,
      createdAt: new Date().toISOString(),
      worker: environment === "production" ? "mf100-api" : "mf100-api-staging",
      workerVersion: null,
      pagesDeployment: null,
      convexBackup: null,
      r2Backup: null,
      status: "prepared",
      // Deployment identifiers must be recorded after successful commands; never infer success from a Git SHA.
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(file);
