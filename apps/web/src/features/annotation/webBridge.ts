import {
  formatWebPlace,
  formatWebViewport,
  type Anchor,
  type NormalizedRect,
  type PageRect,
  type WebAnchorCandidate,
  type WebElementPlace,
  type WebViewport,
} from "@mf100/domain";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { WEB_DEVICES } from "@/features/social/preview/devices";

/**
 * ライブ表示（iframe）と、サイト側のブリッジ（public/bridge.js）とのやり取り。
 * メッセージは postMessage だけで、相手のオリジンは添付の URL のオリジンに固定する（送るときの targetOrigin、受けるときの origin と source）。
 * ブリッジが返すのは要素の候補と矩形で、どの候補を採るか（attached / moved / detached）は domain の resolveWebAnchor が決める。
 */
export type BridgeState = "loading" | "ready" | "no_bridge";

/** 子 → 親: 押した・なぞった・文字を選んだ要素 */
export interface BridgeHit {
  url: string;
  selector: WebElementPlace["selector"];
  /** 要素の境界ボックス（文書座標 px） */
  elementRect: PageRect;
  rect?: NormalizedRect;
  point?: { x: number; y: number };
  page: { pageX: number; pageY: number; scrollY: number };
  viewport: { width: number; height: number; dpr: number };
  text?: string;
}

export interface BridgeRects {
  items: Array<{ id: string; candidates: WebAnchorCandidate[] }>;
  scroll: { x: number; y: number };
  viewport: { width: number; height: number; dpr: number };
  url: string;
  docHeight: number;
}

type Incoming =
  | ({ type: "ready" } & Pick<BridgeRects, "url" | "viewport" | "scroll" | "docHeight"> & {
        title: string;
      })
  | ({ type: "hit" } & BridgeHit)
  | ({ type: "rects" } & BridgeRects)
  | { type: "navigate"; url: string };

export interface ResolveTarget {
  id: string;
  selector: WebElementPlace["selector"];
  fallback: WebElementPlace["fallback"];
}

/** ブリッジが `ready` を返すのを待つ時間（iframe の load の後）。来なければ埋め込み拒否かスニペット未設置とみなす（WB-07） */
export const BRIDGE_READY_TIMEOUT_MS = 2500;
/** load も来ないときの全体の上限 */
export const BRIDGE_TOTAL_TIMEOUT_MS = 9000;

export function siteOriginOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function useWebBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  url: string,
  handlers: {
    onHit?: (hit: BridgeHit) => void;
    onRects?: (r: BridgeRects) => void;
    onNavigate?: (url: string) => void;
  },
) {
  const origin = siteOriginOf(url);
  const [state, setState] = useState<BridgeState>("loading");
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);
  /** ready が来た回数（サイトの中でページを移った・再読み込みしたら新しい文書なので、モードと探す要素を送り直す） */
  const [readyKey, setReadyKey] = useState(0);
  const h = useRef(handlers);
  h.current = handlers;
  /** 読み込みの世代（再読み込みで前の timer・ready を無効にする） */
  const [gen, setGen] = useState(0);
  const stateRef = useRef<BridgeState>("loading");
  const set = (s: BridgeState) => {
    stateRef.current = s;
    setState(s);
  };

  const post = useCallback(
    (msg: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !origin) return;
      win.postMessage({ source: "mf100-host", v: 1, ...msg }, origin);
    },
    [origin, iframeRef],
  );

  useEffect(() => {
    set("loading");
    setPage(null);
    if (!origin) {
      set("no_bridge");
      return;
    }
    const onMessage = (e: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || e.origin !== origin || e.source !== iframe.contentWindow) return;
      const d = e.data as (Incoming & { source?: string }) | null;
      if (!d || d.source !== "mf100-bridge") return;
      if (d.type === "ready") {
        set("ready");
        setReadyKey((k) => k + 1);
        setPage({ url: d.url, title: d.title });
        h.current.onNavigate?.(d.url);
      } else if (d.type === "hit") h.current.onHit?.(d);
      else if (d.type === "rects") h.current.onRects?.(d);
      else if (d.type === "navigate") h.current.onNavigate?.(d.url);
    };
    window.addEventListener("message", onMessage);
    const iframe = iframeRef.current;
    let afterLoad = 0;
    const onLoad = () => {
      window.clearTimeout(afterLoad);
      afterLoad = window.setTimeout(() => {
        if (stateRef.current === "loading") set("no_bridge");
      }, BRIDGE_READY_TIMEOUT_MS);
    };
    iframe?.addEventListener("load", onLoad);
    const total = window.setTimeout(() => {
      if (stateRef.current === "loading") set("no_bridge");
    }, BRIDGE_TOTAL_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      iframe?.removeEventListener("load", onLoad);
      window.clearTimeout(afterLoad);
      window.clearTimeout(total);
    };
  }, [origin, url, gen, iframeRef]);

  const reload = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe) {
      // src を付け直す（別オリジンの contentWindow.location には触れない）
      const src = iframe.src;
      iframe.src = "about:blank";
      window.setTimeout(() => {
        iframe.src = src;
      }, 0);
    }
    setGen((g) => g + 1);
  }, [iframeRef]);

  // 送る関数は post に対して安定させる（effect の依存に入れても毎回は走らない）
  const api = useMemo(
    () => ({
      post,
      reload,
      setMode: (mode: "off" | "browse" | "comment") => post({ type: "mode", mode }),
      resolve: (anchors: ResolveTarget[]) => post({ type: "resolve", anchors }),
      scrollTo: (id: string) => post({ type: "scrollTo", id }),
      highlight: (id: string | null) => post({ type: "highlight", id }),
    }),
    [post, reload],
  );
  return { state, page, readyKey, ...api };
}

type WebAnchor = Extract<Anchor, { type: "web_element" }>;

/** 端末プリセットの表示名（保存した deviceId から。無ければ「幅 nnnpx」） */
export function webDeviceLabel(vp: WebViewport): string | null {
  return WEB_DEVICES.find((d) => d.id === vp.deviceId)?.label ?? null;
}

/** 場所の短い表示（カード・一覧用）: 「iPhone 17（402px）・h2」 */
export function webPlaceLabel(a: WebAnchor): string {
  return formatWebPlace(a, webDeviceLabel(a.viewport));
}

/** 端末幅だけ: 「iPhone 17（402px）」「幅 1440px」 */
export function webViewportLabel(a: WebAnchor): string {
  return formatWebViewport(a.viewport, webDeviceLabel(a.viewport));
}
