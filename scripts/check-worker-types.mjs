import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const directory = mkdtempSync(join(tmpdir(), "refine-types-"));
try {
  const output = join(directory, "worker-configuration.d.ts");
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "types", output, "--config", "wrangler.jsonc"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    // Generated header includes the output path; compare declarations rather than the command comment.
    const declarations = (file) =>
      readFileSync(file, "utf8")
        .replace(/^\/\/.*\n/gm, "")
        .replace(
          /mainModule: typeof import\("[^"]+"\)/,
          'mainModule: typeof import("./src/index")',
        );
    if (declarations(output) !== declarations("worker-configuration.d.ts")) {
      console.error(
        "Worker bindings changed. Run pnpm --filter @mf100/api types and commit the result.",
      );
      process.exitCode = 1;
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
