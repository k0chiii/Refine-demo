import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { Component, useEffect, type ReactNode } from "react";
import { artifactFiles } from "@/integrations/api";
import { mayPersist } from "@/lib/fileCachePolicy";
import { defaultArtifactId } from "./defaultArtifact";

/**
 * 校正画面（/works/:id）を開くとき、画面の準備（アプリの枠のための `me` の取得）と並行して、制作物 → 添付 → ファイルを先に取りに行く。
 * 以前は `me` が届いて Editor が現れてから works.get → revisions.get → ファイルの順に直列だった（往復 3 回分遅れて始まる）。
 * - works.get の購読は Editor の購読と同じもの（Convex が共有するので、問い合わせは増えない）
 * - works.get が既定で開く版の添付の要約（defaultArtifacts）を返すので、版の問い合わせを待たずにファイルを先取りする
 *   （PDF なら先頭が届き次第、受け取りながら描ける）。既定の版を開くとき（/works/:id）だけ。版を指定した画面は先取りしない
 * - 失敗しても何もしない（Editor が自分で同じ問い合わせをして、エラーを表示する）
 */
const EDITOR_PATH = /^\/works\/([^/]+)\/?$/;

export function editorWorkIdOf(path: string): string | null {
  const m = EDITOR_PATH.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
}

class Silent extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Prefetch({ workId }: { workId: string }) {
  const token = useAuthToken();
  const work = useQuery(api.works.get, { workId });
  const open = work?.defaultArtifacts ?? null;
  useEffect(() => {
    if (!work || !open || !token) return;
    const id = defaultArtifactId(open.artifacts, work.work.mediaType);
    const artifact = open.artifacts.find((a) => a.id === id);
    if (!id || !artifact || artifact.role === "external") return;
    artifactFiles.prefetch(token, id, { persist: mayPersist(work.work.confidentiality) });
  }, [open?.revisionId, token !== null]);
  return null;
}

/** 認証が済んだあと、校正画面のパスのときだけ先取りする（何も描かない） */
export function EditorPrefetch({ path }: { path: string }) {
  const workId = editorWorkIdOf(path);
  if (!workId) return null;
  return (
    <Silent>
      <Prefetch workId={workId} />
    </Silent>
  );
}
