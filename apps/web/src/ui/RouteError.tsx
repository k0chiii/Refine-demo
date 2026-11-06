import type { ErrorComponentProps } from "@tanstack/react-router";
import { M3eButton } from "@m3e/react/button";
import { failedToLoad, recoverFromLoadError } from "@/lib/pwa";

/**
 * 画面のエラー（ルーターの既定の英語のエラー画面の代わり）。
 * 画面のコードを読めなかったとき（デプロイのあとの古い外枠・通信の途切れ）は、lib/pwa.ts が新しい版への切り替えか読み直しを進める。
 * 自動で直せないとき（1 分以内に読み直したあと）のために「再読み込み」を置く
 */
export function RouteError({ error }: ErrorComponentProps) {
  const load = failedToLoad();
  return (
    <div className="empty route-error" data-route-error={load ? "load" : "error"}>
      {load ? (
        <>
          <span className="title-medium">画面を読み込めませんでした</span>
          通信が途切れたか、新しいバージョンが出ています。自動で開き直さないときは「再読み込み」を押してください
        </>
      ) : (
        <>
          <span className="title-medium">問題が起きました</span>
          <pre>{error instanceof Error ? error.message : String(error)}</pre>
        </>
      )}
      <M3eButton variant="filled" onClick={() => void recoverFromLoadError({ force: true })}>
        再読み込み
      </M3eButton>
    </div>
  );
}
