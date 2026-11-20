import { defineConfig } from "@mizchi/mutator";

// 読み取り量を減らすために持つ派生データの保守（docs/COST.md）。
// 差分を残す・数が動かないときは書かない、という性質が崩れると読み取り量と OCC の衝突が戻るので、
// ここで生き残る変異はすべてテストで殺すか、理由を付けて accept する。
const costPaths = [
  "convex/lib/assignmentOpen.ts",
  "convex/lib/workSummary.ts",
  "convex/lib/workCounters.ts",
];

export default defineConfig({
  include: costPaths,
  critical: costPaths,
  vitestConfig: "vite.config.ts",
  reporters: ["text"],
});
