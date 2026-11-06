import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useRef, useState } from "react";
import { artifactFiles } from "@/integrations/api";
import type { ArtifactDownload } from "@/lib/artifactFiles";
import { describeError } from "@/lib/errors";

interface State {
  /** どの添付の状態か（添付が替わった直後の描画で、前の添付の中身を出さない） */
  forId: string | null;
  url: string | null;
  blob: Blob | null;
  /** 取得中のものを含む（PDF は受け取りながら開く）。メモリ・端末の写しから開いたときは取得済み */
  download: ArtifactDownload | null;
  error: string | null;
  loading: boolean;
}

const idle: State = {
  forId: null,
  url: null,
  blob: null,
  download: null,
  error: null,
  loading: false,
};

/**
 * 添付を認可付きで取得し、Blob URL を返す（docs/UI_M3E.md §77）。
 * - 取得は lib/artifactFiles が共有する: 同じ添付を他の場所（自動校正・版比較・ダウンロード）が同時に欲しがっても通信は 1 回。
 *   取得済みならメモリから、端末の写しがあればそこから即座に開く
 * - 取得中でも `download` は先に返す。PDF は全部の到着を待たずにそこから開ける
 * - トークンは更新される（保存済みのトークンで始め、少しあとに更新される）。更新のたびに取り直さないよう、
 *   このフックは「サインイン済みか」だけに依存し、取得のたびの最新のトークンは artifactFiles が持つ
 * - 権限が剥奪された（写しから開いたあと、裏の確認で拒否された）ときはエラーにして中身を外す
 * persist: 端末に残してよいか（制作物の機密区分から呼び手が決める。lib/fileCachePolicy）
 */
export function useArtifactBlob(artifactId: string | null, opts: { persist?: boolean } = {}) {
  const token = useAuthToken();
  const signedIn = token !== null;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const persist = Boolean(opts.persist);
  const [state, setState] = useState<State>(idle);

  useEffect(() => {
    const t = tokenRef.current;
    if (!artifactId || !t) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const download = artifactFiles.open(t, artifactId, { persist });
    const show = (blob: Blob) => {
      objectUrl = URL.createObjectURL(blob);
      setState({ forId: artifactId, url: objectUrl, blob, download, error: null, loading: false });
    };
    if (download.completed) show(download.completed);
    else {
      setState({ forId: artifactId, url: null, blob: null, download, error: null, loading: true });
      download.blob.then(
        (blob) => {
          if (!cancelled) show(blob);
        },
        (e: unknown) => {
          if (!cancelled)
            setState({
              forId: artifactId,
              url: null,
              blob: null,
              download: null,
              error: describeError(e).message,
              loading: false,
            });
        },
      );
    }
    const off = artifactFiles.onRevoked((id) => {
      if (id !== artifactId || cancelled) return;
      setState({
        forId: artifactId,
        url: null,
        blob: null,
        download: null,
        error: "このファイルを閲覧する権限がありません",
        loading: false,
      });
    });
    return () => {
      cancelled = true;
      off();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, signedIn, persist]);

  return state.forId === artifactId && artifactId !== null ? state : idle;
}
