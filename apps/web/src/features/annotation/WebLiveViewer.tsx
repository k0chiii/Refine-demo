import {
  placeIn,
  resolveWebAnchor,
  toViewportUnit,
  type Anchor,
  type PageRect,
  type Viewport,
  type WebAnchorCandidate,
  type WebAnchorState,
  type WebElementPlace,
} from "@mf100/domain";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DeviceFrame } from "@/features/social/preview/PostPreview";
import {
  WEB_DEFAULT_DEVICE,
  WEB_DEVICES,
  outerSize,
  webDeviceById,
  webDeviceForWidth,
  type DeviceKind,
  type DeviceSpec,
} from "@/features/social/preview/devices";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet } from "@/ui/ActionSheet";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eCard } from "@m3e/react/card";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItemGroup, M3eMenuItemRadio, M3eMenuTrigger } from "@m3e/react/menu";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";
import { useWebBridge, webDeviceLabel, type BridgeHit, type BridgeRects } from "./webBridge";

/** コメントの下書き（ブリッジが返した要素と、付けたときの端末） */
export interface WebDraft {
  place: WebElementPlace;
  /** 要素の境界ボックス（文書座標。投稿欄の位置に使う） */
  elementRect: PageRect;
  /** 端末の表示名（投稿欄の「iPhone 17（402px）・h2」） */
  deviceLabel: string | null;
}

type WebAnchor = Extract<Anchor, { type: "web_element" }>;
const isWebAnchor = (a: Anchor): a is WebAnchor => a.type === "web_element";

const DEVICE_KEY = "mf100.web.device";
const GROUPS: readonly [DeviceKind, string][] = [
  ["iphone", "iPhone"],
  ["android", "Android"],
  ["tablet", "タブレット"],
  ["pc", "PC"],
];
/** 上のバー・バナー・下の説明の見込みの高さ。枠はこれを除いた高さに収める */
const CHROME_H = 168;
const PC_BAR_H = 40;

interface Props {
  url: string;
  artifactId: string;
  /** 「第1版の外部リンク「https://…」」 */
  label: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** コメント（FB）を付けられるか */
  selecting: boolean;
  draft: WebDraft | null;
  onDraft: (d: WebDraft | null) => void;
  /** カードを押したとき、その要素へ移す（必要なら端末も合わせる）。key が変わるたびに */
  focusRequest?: { anchor: WebAnchor; key: number } | null;
  /** 再アンカーの結果（カードに「位置が外れました」を出す） */
  onStates?: (states: ReadonlyMap<string, WebAnchorState>) => void;
  /** 投稿欄（ビューアの上）。vp は画面（縮小後）の大きさ、box は選んだ要素の位置（縮小後の px） */
  renderInPage?: (vp: Viewport, box: PageRect | null) => ReactNode;
  /** 下に置くもの（外部での議論の結果の記録） */
  footer?: ReactNode;
}

function readDevice(): string {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    if (v && WEB_DEVICES.some((d) => d.id === v)) return v;
  } catch {}
  return WEB_DEFAULT_DEVICE;
}

/**
 * Web サイトのライブ表示（docs/FIGMA_WEB_PROOFING.md WB-03〜WB-07・WB-12。利用者指示 2026-10-17）。
 * - 端末プリセット（SNS プレビューの機種＋タブレット・PC の幅）で iframe を実機の CSS ピクセルで組み、置き場所に収まるよう縮める。
 *   スマホは実機のベゼル（PostPreview の DeviceFrame）。回転と、PC は幅の直接指定もできる
 * - 「閲覧／コメント」: コメントでは iframe の中のブリッジが押した要素（セレクタ・引用文・要素の中の位置）を返し、
 *   その場に投稿欄が出る。印は要素の今の位置に親が描く（スクロール・端末の切り替えに追随）
 * - ブリッジが `ready` を返さないサイト（埋め込み拒否・スニペット未設置）は、理由と「新しいタブで開く」を出す
 * - ライブ表示は今の内容（CM-03）。実機の UA・DPR・タッチは再現されない（WB-12）
 */
export function WebLiveViewer({
  url,
  artifactId,
  label,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  draft,
  onDraft,
  focusRequest,
  onStates,
  renderInPage,
  footer,
}: Props) {
  const compact = useWindowClass() === "compact";
  const [deviceId, setDeviceId] = useState(readDevice);
  const [landscape, setLandscape] = useState(false);
  /** PC の幅の直接指定（端末を選ぶと消える） */
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [mode, setMode] = useState<"browse" | "comment">("browse");
  const [sheet, setSheet] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const scaledRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  /** 枠（ベゼル・PC のバー）の中の画面の穴の位置（縮める前の px）。iframe はここに重ねる */
  const [slot, setSlot] = useState({ x: 0, y: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [rects, setRects] = useState<BridgeRects | null>(null);
  const [pageUrl, setPageUrl] = useState<string>("");
  const menuId = `wdev-${useId().replace(/:/g, "")}`;
  const widthId = `wwidth-${useId().replace(/:/g, "")}`;

  const spec: DeviceSpec = useMemo(() => {
    const base = webDeviceById(deviceId);
    if (customWidth !== null && base.kind === "pc") return { ...base, w: customWidth };
    return base;
  }, [deviceId, customWidth]);
  const pc = spec.kind === "pc";
  /** 画面の大きさ（CSS ピクセル。回転は幅と高さを入れ替え、ベゼル画像は使わない） */
  const shown: DeviceSpec = useMemo(() => {
    if (pc) return spec;
    if (!landscape) return spec;
    const { bezel: _drop, ...rest } = spec;
    return { ...rest, w: spec.h, h: spec.w, top: 0, bottom: spec.bottom };
  }, [spec, landscape, pc]);

  // 置き場所の大きさ（padding を除く）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const cs = getComputedStyle(el);
      setBox({
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const availH = Math.max(480, box.h - CHROME_H);
  // PC: 幅を枠に収める倍率で、高さは置き場所いっぱい。スマホ・タブレット: 外形（ベゼル込み）が幅と高さに収まる倍率
  const outer = pc ? { w: shown.w, h: 0 } : outerSize(shown);
  const scale =
    box.w <= 0
      ? 1
      : pc
        ? Math.min(1, box.w / outer.w)
        : Math.min(1, box.w / outer.w, availH / outer.h);
  const screenW = shown.w;
  const screenH = pc ? Math.max(480, Math.round(availH / scale) - PC_BAR_H) : shown.h - shown.top;
  const outerH = pc ? screenH + PC_BAR_H : outer.h;

  // ブリッジ
  const mine = useMemo(
    () =>
      threads.filter(
        (t): t is OverlayThread & { anchor: WebAnchor } =>
          isWebAnchor(t.anchor) && t.anchor.artifactId === artifactId,
      ),
    [threads, artifactId],
  );
  const deviceLabel = pc && customWidth !== null ? null : spec.label;
  const bridge = useWebBridge(iframeRef, url, {
    onHit: (hit: BridgeHit) => {
      const place: WebElementPlace = {
        url: hit.url,
        selector: hit.selector,
        ...(hit.rect ? { rect: hit.rect } : hit.point ? { point: hit.point } : {}),
        viewport: {
          width: screenW,
          height: screenH,
          dpr: 1,
          orientation: landscape ? "landscape" : "portrait",
          ...(deviceLabel && !(pc && customWidth !== null) ? { deviceId: spec.id } : {}),
        },
        fallback: hit.page,
      };
      onDraft({ place, elementRect: hit.elementRect, deviceLabel });
    },
    onRects: setRects,
    onNavigate: setPageUrl,
  });
  const { state, readyKey, resolve, setMode: sendMode, scrollTo, highlight, reload } = bridge;
  // 準備ができたら（サイトの中でページを移ったときも）、モードと探す要素を送る。コメントの一覧が変わっても送り直す
  const targetsKey = mine.map((t) => t.id).join(",");
  useEffect(() => {
    if (state !== "ready") return;
    sendMode(selecting ? mode : "browse");
  }, [state, readyKey, mode, selecting, sendMode]);
  useEffect(() => {
    if (state !== "ready") return;
    resolve(
      mine.map((t) => ({ id: t.id, selector: t.anchor.selector, fallback: t.anchor.fallback })),
    );
  }, [state, readyKey, targetsKey, resolve]);
  // 端末を切り替えたら iframe の大きさが変わる（ブリッジが resize で rects を送る）。選び直しの投稿欄は消す
  useEffect(() => {
    setRects(null);
    onDraft(null);
  }, [spec.id, customWidth, landscape]);
  useEffect(() => {
    if (!selecting) setMode("browse");
  }, [selecting]);
  useEffect(() => {
    if (state === "ready") highlight(activeThreadId);
  }, [activeThreadId, state, highlight]);

  // 再アンカー（domain）: 候補から印の場所と状態を決める
  const resolved = useMemo(() => {
    const out = new Map<string, { state: WebAnchorState; rect: PageRect }>();
    if (!rects) return out;
    const byId = new Map(rects.items.map((i) => [i.id, i.candidates] as const));
    for (const t of mine) {
      const cands: WebAnchorCandidate[] = byId.get(t.id) ?? [];
      // 別のページにいるときは探さない（見つからないのを「外れた」と言わない）
      if (t.anchor.url.split("?")[0] !== rects.url.split("?")[0]) continue;
      out.set(t.id, resolveWebAnchor(t.anchor, cands));
    }
    return out;
  }, [rects, mine]);
  const statesKey = useRef("");
  useEffect(() => {
    if (!onStates) return;
    const states = new Map([...resolved].map(([id, r]) => [id, r.state] as const));
    const key = [...states].map(([id, s]) => `${id}:${s}`).join("|");
    if (key === statesKey.current) return;
    statesKey.current = key;
    onStates(states);
  }, [resolved, onStates]);

  // 印: 要素の今の位置を、見えている範囲の 0..1 に直して画像の印として描く（画面の外のものは描かない）
  const size = { width: screenW, height: screenH };
  const scroll = rects?.scroll ?? { x: 0, y: 0 };
  const overlayThreads: OverlayThread[] = useMemo(() => {
    const out: OverlayThread[] = [];
    for (const t of mine) {
      const r = resolved.get(t.id);
      if (!r) continue;
      const u = toViewportUnit(r.rect, scroll, size);
      if (!u) continue;
      const anchor: Anchor =
        u.w > 0 && u.h > 0
          ? { type: "image_rect", artifactId, rect: u }
          : { type: "image_pin", artifactId, point: { x: u.x, y: u.y } };
      out.push({ ...t, anchor });
    }
    return out;
  }, [mine, resolved, scroll.x, scroll.y, size.width, size.height, artifactId]);
  const draftUnit = useMemo(() => {
    if (!draft) return null;
    const r = placeIn(draft.place, draft.elementRect);
    const u = toViewportUnit(r, scroll, size);
    if (!u) return null;
    return u.w > 0 && u.h > 0 ? { rect: u } : { point: { x: u.x, y: u.y } };
  }, [draft, scroll.x, scroll.y, size.width, size.height]);

  // カードを押した: 端末を合わせて（同じ幅のプリセットがあれば）、その要素へ
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const a = focusRequest.anchor;
    const id = mine.find(
      (t) => t.anchor === a || t.id === threads.find((x) => x.anchor === a)?.id,
    )?.id;
    const target = id ?? threads.find((x) => x.anchor === a)?.id ?? null;
    const w = a.viewport.orientation === "landscape" ? a.viewport.height : a.viewport.width;
    const dev = a.viewport.deviceId
      ? WEB_DEVICES.find((d) => d.id === a.viewport.deviceId)
      : webDeviceForWidth(w);
    const changed = dev
      ? dev.id !== spec.id || landscape !== (a.viewport.orientation === "landscape")
      : false;
    if (dev) {
      pick(dev.id);
      setLandscape(a.viewport.orientation === "landscape");
    } else if (w >= 600) {
      pick("pc-1440");
      setCustomWidth(w);
    }
    if (!target) return;
    if (changed || state !== "ready") pendingScroll.current = target;
    else scrollTo(target);
  }, [focusRequest?.key]);
  useEffect(() => {
    if (state === "ready" && rects && pendingScroll.current) {
      const id = pendingScroll.current;
      pendingScroll.current = null;
      // iframe の大きさが変わった直後は配置が落ち着くのを待つ
      const t = window.setTimeout(() => scrollTo(id), 150);
      return () => window.clearTimeout(t);
    }
  }, [state, rects?.viewport.width, rects?.viewport.height]);

  const pick = (id: string) => {
    setDeviceId(id);
    setCustomWidth(null);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {}
  };

  // 枠の中の穴の位置（iframe を枠の子にすると、スマホ ⇄ PC で枠が変わるたびに iframe が作り直されて再読み込みになる）
  useLayoutEffect(() => {
    const scaled = scaledRef.current;
    const hole = slotRef.current;
    if (!scaled || !hole || scale <= 0) return;
    const a = scaled.getBoundingClientRect();
    const b = hole.getBoundingClientRect();
    const next = { x: (b.left - a.left) / scale, y: (b.top - a.top) / scale };
    setSlot((cur) => (cur.x === next.x && cur.y === next.y ? cur : next));
  }, [scale, screenW, screenH, shown.id, landscape, pc]);
  // 投稿欄を置く層（縮小していない座標）: 画面の位置を測って重ねる
  const [layer, setLayer] = useState({ x: 0, y: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const fit = fitRef.current;
    const screen = screenRef.current;
    if (!fit || !screen) return;
    const a = fit.getBoundingClientRect();
    const b = screen.getBoundingClientRect();
    setLayer({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height });
  }, [scale, screenW, screenH, shown.id, landscape, slot.x, slot.y]);
  const vp: Viewport = { width: layer.w, height: layer.h, rotation: 0 };
  const draftBox: PageRect | null = useMemo(() => {
    if (!draft) return null;
    const r = placeIn(draft.place, draft.elementRect);
    return {
      x: (r.x - scroll.x) * scale,
      y: (r.y - scroll.y) * scale,
      w: r.w * scale,
      h: r.h * scale,
    };
  }, [draft, scroll.x, scroll.y, scale]);

  const noBridge = state === "no_bridge";
  const deviceIcon = pc ? "computer" : spec.kind === "tablet" ? "tablet_mac" : "smartphone";
  const sizeText = `${screenW}×${pc ? "—" : shown.h}`;
  const iframeTitle = `ライブ表示: ${label}（${spec.label}、${sizeText}）`;
  // リンクは素の <a>（M3E の button に href を付けると中の a が入れ子の操作になる。§35 nested-interactive）
  const openNew = (
    <a className="link-button" href={url} target="_blank" rel="noreferrer noopener">
      <M3eIcon name="open_in_new" />
      新しいタブで開く
    </a>
  );

  const screen = (
    <div
      ref={screenRef}
      className={`wlive__screen ${mode === "comment" ? "wlive__screen--comment" : ""}`}
      style={{
        width: screenW,
        height: screenH,
        left: slot.x,
        top: slot.y,
        borderRadius: `0 0 ${pc ? 12 : shown.radius}px ${pc ? 12 : shown.radius}px`,
      }}
    >
      <iframe
        ref={iframeRef}
        className="wlive__frame"
        title={iframeTitle}
        src={url}
        width={screenW}
        height={screenH}
        // サイトは自分のオリジンのまま動く（Cookie・スクリプト）。親のページを乗っ取る許可は与えない
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="eager"
      />
      {state === "ready" ? (
        <div className="wlive__marks">
          <AnchorOverlay
            viewport={{ width: screenW, height: screenH, rotation: 0 }}
            threads={overlayThreads}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
            selecting={false}
            draft={draftUnit}
            onDraft={() => undefined}
          />
        </div>
      ) : null}
      {state === "loading" ? (
        // iframe の上に重ねるので contained（M3: 他の中身の上では容器付きで目立たせる）
        <Loading
          calm
          contained
          caption
          label="サイトを読み込んでいます"
          className="wlive__loading"
        />
      ) : null}
    </div>
  );

  return (
    <div className="viewer wlive">
      <div className="viewer__stage wlive__stage" ref={stageRef}>
        {/* CM-03: ライブ表示は今の内容。版の内容は添付 */}
        <p className="wlive__banner" role="note">
          <M3eIcon name="info" />
          ライブ表示は今のサイトの内容です。この版の内容はこの版の添付（スクリーンショット・画像）で確かめてください。サイト側のコメントは同期されません
        </p>
        <div className="wlive__bar" role="toolbar" aria-label="ライブ表示の操作">
          <M3eButton
            variant="tonal"
            className="wlive__device"
            aria-label={`端末 ${spec.label}（変える）`}
            {...(compact ? { onClick: () => setSheet(true) } : {})}
          >
            <M3eIcon slot="icon" name={deviceIcon} />
            {spec.label}
            {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
          </M3eButton>
          {compact ? (
            <ActionSheet
              open={sheet}
              onClose={() => setSheet(false)}
              title="端末"
              items={WEB_DEVICES.map((d) => ({
                icon:
                  d.kind === "pc" ? "computer" : d.kind === "tablet" ? "tablet_mac" : "smartphone",
                label: d.kind === "pc" ? d.label : `${d.label}（${d.w}×${d.h}）`,
                selected: d.id === spec.id && customWidth === null,
                onSelect: () => pick(d.id),
              }))}
            />
          ) : (
            <M3eMenu id={menuId}>
              {GROUPS.map(([kind, name]) => (
                <M3eMenuItemGroup key={kind} aria-label={name}>
                  {WEB_DEVICES.filter((d) => d.kind === kind).map((d) => (
                    <M3eMenuItemRadio
                      key={d.id}
                      checked={d.id === spec.id && customWidth === null}
                      onClick={() => pick(d.id)}
                    >
                      {d.kind === "pc" ? d.label : `${d.label}（${d.w}×${d.h}）`}
                    </M3eMenuItemRadio>
                  ))}
                </M3eMenuItemGroup>
              ))}
            </M3eMenu>
          )}
          {pc ? (
            <M3eFormField variant="outlined" hideSubscript="always" className="wlive__width">
              <label slot="label" htmlFor={widthId}>
                幅（px）
              </label>
              <input
                id={widthId}
                type="number"
                min={320}
                max={4000}
                step={10}
                value={screenW}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 320 && v <= 4000) setCustomWidth(Math.round(v));
                }}
              />
            </M3eFormField>
          ) : (
            <M3eIconButton
              aria-label={landscape ? "縦向きにする" : "横向きにする"}
              toggle
              selected={landscape}
              onClick={() => setLandscape((v) => !v)}
            >
              <M3eIcon name="screen_rotation" className={landscape ? "icon--filled" : ""} />
            </M3eIconButton>
          )}
          <span className="spacer" />
          {selecting && !noBridge ? (
            <ChoiceGroup
              label="操作"
              className="wlive__mode"
              value={mode}
              onChange={setMode}
              disabled={state !== "ready"}
              choices={[
                { value: "browse", label: "閲覧", icon: "visibility" },
                { value: "comment", label: "コメント", icon: "add_comment" },
              ]}
            />
          ) : null}
          <M3eIconButton aria-label="再読み込み" onClick={reload}>
            <M3eIcon name="refresh" />
          </M3eIconButton>
          <a
            className="link-icon"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="新しいタブで開く"
            title="新しいタブで開く"
          >
            <M3eIcon name="open_in_new" />
          </a>
        </div>
        {noBridge ? (
          <M3eCard variant="outlined" className="wlive__refused">
            <div slot="content" className="wlive__refused-body">
              <M3eIcon name="block" />
              <div>
                <p className="title-small">このサイトはここに表示できません</p>
                <p className="small muted">
                  サイトが埋め込みを拒否している（X-Frame-Options・CSP の
                  frame-ancestors）か、校正システムのブリッジ（bridge.js）が置かれていません。
                  委員会のサイトなら Web
                  担当にブリッジの設置を頼んでください。それまでは、この版に添付したスクリーンショットの上でコメントしてください
                </p>
                <div className="row">{openNew}</div>
              </div>
            </div>
          </M3eCard>
        ) : null}
        <div
          className={`wlive__fit ${noBridge ? "wlive__fit--hidden" : ""}`}
          ref={fitRef}
          style={{ width: outer.w * scale, height: outerH * scale }}
        >
          <div
            ref={scaledRef}
            className="wlive__scaled"
            style={{ width: outer.w, height: outerH, transform: `scale(${scale})` }}
          >
            {/* iframe は枠の兄弟（穴の位置に重ねる）。枠が変わっても作り直さない */}
            {screen}
            {pc ? (
              <div className="wlive__pc" style={{ width: outer.w }}>
                <div className="wlive__pc-bar" aria-hidden="true">
                  <span className="wlive__pc-dots" />
                  <span className="wlive__pc-url">{siteDisplay(url, pageUrl)}</span>
                </div>
                <div
                  ref={slotRef}
                  className="wlive__slot"
                  style={{ width: screenW, height: screenH }}
                />
              </div>
            ) : (
              <DeviceFrame spec={shown} dark={false}>
                <div
                  ref={slotRef}
                  className="wlive__slot"
                  style={{ width: screenW, height: screenH }}
                />
              </DeviceFrame>
            )}
          </div>
          {renderInPage && layer.w > 0 ? (
            <div
              className="wlive__layer"
              style={{ left: layer.x, top: layer.y, width: layer.w, height: layer.h }}
            >
              {renderInPage(vp, draftBox)}
            </div>
          ) : null}
        </div>
        {!noBridge ? (
          <p className="wlive__caption">
            {pc ? `PC（幅 ${screenW}px` : `${spec.label}（画面 ${sizeText}`}
            {scale < 1 ? `、実寸の ${Math.round(scale * 100)}% で表示` : ""}）。
            {mode === "comment"
              ? "サイトの要素を押すとその要素に、なぞると要素の中の範囲に、文字を選ぶとその文字にコメントできます。"
              : selecting
                ? "「コメント」に切り替えると要素を指してコメントできます。"
                : ""}
            実機の UA・DPR・タッチ・Safari
            固有の表示は再現されません。確定の表示は実機で確かめてください
          </p>
        ) : null}
        {footer}
      </div>
    </div>
  );
}

function siteDisplay(url: string, pageUrl: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${pageUrl || u.pathname}`;
  } catch {
    return url;
  }
}

export { webDeviceLabel };
