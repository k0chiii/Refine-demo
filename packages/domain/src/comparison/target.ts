import { isAllowed, type AuthorizationContext } from "../acl/authorize.ts";
import { pickReviewArtifact, type Artifact } from "../revision/Artifact.ts";

/**
 * 比べる相手（左に置く版）の範囲（利用者指示 2026-10-17「同じ制作物の過去のものだけでなく、別の制作物についても」）。
 * - same_work: 同じ制作物の別の版（従来どおり。旧版と新版）
 * - cross_work: 別の制作物の版（例: 去年のポスターと今年のポスター、パンフレットと Web の原稿）
 */
export type ComparisonScope = "same_work" | "cross_work";

export function comparisonScope(leftWorkId: string, rightWorkId: string): ComparisonScope {
  return leftWorkId === rightWorkId ? "same_work" : "cross_work";
}

/**
 * 比べる相手の見出し。同じ制作物なら版の名前だけ（「第1版」）、別の制作物なら「題名・版」（「EVE 企画ポスター・第1版」）。
 */
export function compareTargetLabel(
  target: { workId: string; workTitle: string; revisionLabel: string },
  currentWorkId: string,
): string {
  return comparisonScope(target.workId, currentWorkId) === "same_work"
    ? target.revisionLabel
    : `${target.workTitle}・${target.revisionLabel}`;
}

/**
 * 手動のページ対応を直せる人（校正に関わる人 = 版を提出できる人か校正に加われる人（review.participate））。
 * 別の制作物との比較では、表示中（右）の制作物でこの条件を満たせばよい。相手（左）の制作物は見られれば足りる。
 * 手動の対応は表示にだけ使い、どちらの制作物の版も変えないため。
 */
export function canEditAlignment(ctx: AuthorizationContext): boolean {
  return isAllowed("revision.submit", ctx) || isAllowed("review.participate", ctx);
}

type ArtifactLike = Pick<Artifact, "type" | "role" | "fileName">;

/**
 * 比べる相手の版から、表示中の添付と並べる添付を選ぶ。
 * - 同じ制作物: 同じファイル名 → 同じ種類 → 紙面に出す添付（PDF → 画像 → 文章 → 動画）
 * - 別の制作物: ファイル名は一致しないのが普通なので、同じ種類を先に（ページ対応・差分・重ねて比較が使える）→ 同じファイル名 → 紙面に出す添付
 * 外部リンクは並べない。
 */
export function pickCompareArtifact<A extends ArtifactLike>(
  candidates: readonly A[],
  current: Pick<A, "type" | "fileName"> | null,
  scope: ComparisonScope,
): A | null {
  const byName = () =>
    current
      ? candidates.find((a) => a.role !== "external" && a.fileName === current.fileName)
      : undefined;
  const byType = () =>
    current ? candidates.find((a) => a.role !== "external" && a.type === current.type) : undefined;
  const picked = scope === "same_work" ? (byName() ?? byType()) : (byType() ?? byName());
  return picked ?? pickReviewArtifact(candidates, current?.type) ?? null;
}
