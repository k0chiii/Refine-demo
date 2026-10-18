import { pickReviewArtifact, POST_MANIFEST_NAME, type Artifact } from "@mf100/domain";

/**
 * 版を開いたときに紙面に出す添付（利用者が選ぶ前の既定）。Editor がこれで選び、
 * ファイルの先取り（EditorPrefetch）も同じ選び方で取りに行く（食い違うと別のファイルを取ってしまう）。
 * SNS 投稿の台帳（mf100-post.json）があればそれ、無ければ PDF → 画像 → 文章 → 動画（動画の制作物は動画を先に）
 */
export function defaultArtifactId(
  artifacts: ReadonlyArray<Pick<Artifact, "id" | "type" | "role" | "fileName">>,
  mediaType: string,
): string | null {
  return (
    artifacts.find((a) => a.fileName === POST_MANIFEST_NAME)?.id ??
    pickReviewArtifact(artifacts, mediaType === "video" ? "video" : undefined)?.id ??
    artifacts[0]?.id ??
    null
  );
}
