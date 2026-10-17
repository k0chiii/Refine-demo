import {
  formatVideoSpan,
  formatVideoTime,
  roundVideoTime,
  type Anchor,
  type NormalizedRect,
  type Viewport,
} from "@mf100/domain";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItemGroup, M3eMenuItemRadio, M3eMenuTrigger } from "@m3e/react/menu";
import { AnchorOverlay, overlayLabel, type OverlayThread } from "./AnchorOverlay";

/** 動画の下書き（時点・範囲と、画面の上の矩形かピン） */
export interface VideoDraft {
  time?: { start: number; end?: number };
  rect?: NormalizedRect;
  point?: { x: number; y: number };
  /**
   * 範囲を選んでいる途中（I を押して O を待つ・タイムラインをなぞっている間）。投稿欄はまだ出さない
   * （出すと文字欄にフォーカスが移り、O や ← → が動画に届かない）
   */
  marking?: boolean;
}

type VideoAnchor = Extract<Anchor, { type: "video_time" }>;

/**
 * 1 コマの長さ（秒）。ブラウザの動画にはコマ送りの API が無く、フレームレートも取れないので 30fps とみなす
 * （24fps の素材でも 1 回で 1 コマ前後動く）。表示は実際に描かれたコマに合う
 */
const FRAME = 1 / 30;
const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
/** 時点のコメントの画面の印を出す前後の幅（秒）。止めた位置がちょうどでなくても出す */
const POINT_WINDOW = 0.25;
/** 下の操作（タイムライン・ボタン）の高さの見込み。映像はこれを除いた高さに収める */
const CONTROLS_H = 148;
/** O だけ押したときの範囲の長さ（秒） */
const DEFAULT_SPAN = 2;

interface Props {
  url: string;
  artifactId: string;
  /** 動画の名前（どの版のどの添付か。例: 第2版の添付「teaser.mp4」） */
  label: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** コメント（FB）を付けられるか。false なら見るだけ */
  selecting: boolean;
  draft: VideoDraft | null;
  onDraft: (d: VideoDraft | null) => void;
  /** 外から再生位置を移す（コメントのカードを押したときなど）。key が変わるたびに移して止める */
  seekRequest?: { t: number; key: number } | null;
  /** 紙面の横に並べる列の幅＋間隔。幅合わせから差し引く */
  besideWidth?: number;
  renderInPage?: (vp: Viewport) => ReactNode;
  renderGutter?: (vp: Viewport) => ReactNode;
}

const isVideoAnchor = (a: Anchor): a is VideoAnchor => a.type === "video_time";
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * 動画のビューア（動画の校正。利用者指示 2026-10-17: タイムライン指定と範囲選択。Frame.io などに倣う。docs/UI_M3E.md §53）。
 *
 * - **時点のコメント**: 「この時点にコメント」（C）で、止めた位置に付ける。映像の上をドラッグ（スマホは長押し）すると
 *   その時点の画面の範囲（矩形）、押すとピンも付けられる（止めているときだけ。再生中に押すと止まる）
 * - **範囲のコメント**: タイムラインの上の帯（印の段）をドラッグする、I（ここから）と O（ここまで）を押す、
 *   ボタン「ここから」「ここまで」を押す、のどれかで範囲を選ぶ。選んだ範囲は両端のつまみで直せる
 * - **印**: タイムラインの上に、時点は番号の丸、範囲は帯（FB は角丸の四角）。押すとその位置へ移って止まり、そのコメントを開く。
 *   画面の範囲・ピンは、止めていてその時刻にあるものだけ映像の上に出す（再生中は隠す）
 * - **操作**: 再生／一時停止（Space・K）、5 秒戻る・進む（J・L）、1 コマ戻る・進む（←・→。Shift で 1 秒）、
 *   範囲だけを繰り返す（選んだ範囲か、開いているコメントの範囲。無ければ全体）、速さ、消音（M）、全画面（F）
 */
export function VideoViewer({
  url,
  artifactId,
  label,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  draft,
  onDraft,
  seekRequest,
  besideWidth = 0,
  renderInPage,
  renderGutter,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  /** ブラウザが再生できない形式（ProRes の .mov など）。ダウンロードで確かめてもらう */
  const [unplayable, setUnplayable] = useState(false);

  // 舞台の内容の大きさ（padding を除く）
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

  // 映像は幅（横の列を除く）と高さ（下の操作を除く）の両方に収める。縦長の動画（SNS）でも操作が画面に残る
  const availW = Math.max(0, box.w - besideWidth);
  const availH = Math.max(180, box.h - CONTROLS_H);
  const fit = natural && availW > 0 ? Math.min(availW / natural.w, availH / natural.h) : 0;
  const viewport: Viewport | null =
    natural && fit > 0 ? { width: natural.w * fit, height: natural.h * fit, rotation: 0 } : null;
  const controlsW = viewport ? Math.min(availW, Math.max(viewport.width, 560)) : availW;

  const mine = threads.filter(
    (x): x is OverlayThread & { anchor: VideoAnchor } =>
      isVideoAnchor(x.anchor) && x.anchor.artifactId === artifactId,
  );
  const active = mine.find((x) => x.id === activeThreadId) ?? null;
  /** 繰り返す範囲: 選んでいる範囲 → 開いているコメントの範囲。無ければ全体 */
  const loopRange =
    draft?.time?.end !== undefined
      ? { start: draft.time.start, end: draft.time.end }
      : active?.anchor.end !== undefined
        ? { start: active.anchor.start, end: active.anchor.end }
        : null;
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  loopRef.current = loop ? loopRange : null;

  // 再生位置: 再生中は描画のたびに読む（timeupdate は 1 秒に 4 回ほどで、印の位置がぎこちない）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const r = loopRef.current;
      if (r && v.currentTime >= r.end) v.currentTime = r.start;
      setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setT(v.currentTime);
    };
    const onTime = () => setT(v.currentTime);
    const onMeta = () => {
      setNatural({ w: v.videoWidth || 16, h: v.videoHeight || 9 });
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onTime);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    if (v.readyState >= 1) onMeta();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onTime);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
    };
  }, [url]);
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = loop && loopRange === null;
  }, [loop, loopRange === null]);
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const seek = (to: number, pause = true) => {
    const v = videoRef.current;
    if (!v) return;
    if (pause) v.pause();
    const next = clamp(to, 0, duration || v.duration || 0);
    v.currentTime = next;
    setT(next);
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // 範囲を繰り返すときは範囲の外から始めない
      const r = loopRef.current;
      if (r && (v.currentTime < r.start || v.currentTime >= r.end)) v.currentTime = r.start;
      void v.play().catch(() => undefined);
    } else v.pause();
  };
  // 外から（カードを押して）位置を移す
  useEffect(() => {
    if (seekRequest) seek(seekRequest.t);
  }, [seekRequest?.key]);
  // 通知などで開いたコメントがこの動画のものなら、読み込めたらその位置へ
  useEffect(() => {
    if (duration > 0 && active) seek(active.anchor.start);
  }, [duration > 0]);

  const now = () => roundVideoTime(videoRef.current?.currentTime ?? t);
  const keepPlace = () => ({
    ...(draft?.rect ? { rect: draft.rect } : {}),
    ...(draft?.point ? { point: draft.point } : {}),
  });
  /** この時点にコメント（C） */
  const commentHere = () => {
    if (!selecting) return;
    videoRef.current?.pause();
    onDraft({ time: { start: now() } });
  };
  /** ここから（I）: 範囲の始め。終わりが始めより後ならそのまま */
  const markIn = () => {
    if (!selecting) return;
    videoRef.current?.pause();
    const start = now();
    const end = draft?.time?.end;
    onDraft(
      end !== undefined && end > start
        ? { ...keepPlace(), time: { start, end } }
        : { ...keepPlace(), time: { start }, marking: true },
    );
  };
  /** ここまで（O）: 範囲の終わり。始めが無い・後ろなら、少し前（DEFAULT_SPAN 秒）から */
  const markOut = () => {
    if (!selecting) return;
    videoRef.current?.pause();
    const end = now();
    if (end <= 0) return;
    const start =
      draft?.time && draft.time.start < end ? draft.time.start : Math.max(0, end - DEFAULT_SPAN);
    onDraft({ ...keepPlace(), time: { start, end } });
  };
  const clearRange = () => {
    if (draft?.time) onDraft({ ...keepPlace(), time: { start: draft.time.start } });
  };
  /** 範囲を選ぶのをやめて、始めの時点にコメントする */
  const commitMarking = () => {
    if (draft?.marking && draft.time) onDraft({ ...keepPlace(), time: draft.time });
  };
  const toggleFull = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    if (el.closest("input, textarea, [contenteditable='true'], .compose-pop, m3e-menu")) return;
    const onButton = el.closest("button, m3e-button, m3e-icon-button") !== null;
    const v = videoRef.current;
    const step = e.shiftKey ? 1 : FRAME;
    switch (e.key) {
      case " ":
        if (onButton) return; // ボタンの Space はそのボタンを押す
        togglePlay();
        break;
      case "k":
      case "K":
        togglePlay();
        break;
      case "ArrowLeft":
        seek((v?.currentTime ?? t) - step);
        break;
      case "ArrowRight":
        seek((v?.currentTime ?? t) + step);
        break;
      case "j":
      case "J":
        seek((v?.currentTime ?? t) - 5, false);
        break;
      case "l":
      case "L":
        seek((v?.currentTime ?? t) + 5, false);
        break;
      case "i":
      case "I":
        markIn();
        break;
      case "o":
      case "O":
        markOut();
        break;
      case "c":
      case "C":
        if (draft?.marking) commitMarking();
        else commentHere();
        break;
      case "m":
      case "M":
        setMuted((m) => !m);
        break;
      case "f":
      case "F":
        toggleFull();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // 止めているとき、その時刻にある画面の範囲・ピン（再生中は隠す。Frame.io などと同じ）
  const shown: OverlayThread[] = playing
    ? []
    : mine.flatMap((x) => {
        const a = x.anchor;
        if (!a.rect && !a.point) return [];
        const at =
          a.end !== undefined
            ? t >= a.start - POINT_WINDOW && t <= a.end + POINT_WINDOW
            : Math.abs(t - a.start) <= POINT_WINDOW;
        if (!at) return [];
        const anchor: Anchor = a.rect
          ? { type: "image_rect", artifactId, rect: a.rect }
          : { type: "image_pin", artifactId, point: a.point! };
        return [{ ...x, anchor }];
      });

  return (
    <div className="viewer">
      <div className="viewer__stage" ref={stageRef}>
        {unplayable ? (
          <div className="empty vplayer__unplayable" role="alert">
            この動画はブラウザで再生できない形式です（ProRes の .mov など）。MP4（H.264）か WebM
            で出し直すか、ダウンロードして確認してください
            <a href={url} download>
              ダウンロード
            </a>
          </div>
        ) : null}
        <div
          ref={rootRef}
          hidden={unplayable}
          className={`vplayer ${full ? "vplayer--full" : ""}`}
          style={viewport && !full ? { width: controlsW } : undefined}
          tabIndex={0}
          role="group"
          aria-label={`${label}の再生と校正（Space で再生・停止、← → で 1 コマ、I・O で範囲、C でコメント）`}
          onKeyDown={onKeyDown}
        >
          <div
            className="viewer__page vplayer__frame"
            style={
              viewport && !full ? { width: viewport.width, height: viewport.height } : undefined
            }
            // 再生中に映像を押したら止める（止めているときは、押すとピン・ドラッグで範囲）
            onPointerDownCapture={() => {
              if (playing && selecting) videoRef.current?.pause();
            }}
            onClick={() => {
              if (!selecting) togglePlay();
            }}
          >
            <video
              ref={videoRef}
              src={url}
              preload="auto"
              playsInline
              muted={muted}
              aria-label={label}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                v.playbackRate = rate;
              }}
              onError={() => setUnplayable(true)}
            />
            {viewport ? (
              <AnchorOverlay
                viewport={viewport}
                threads={shown}
                activeThreadId={activeThreadId}
                onSelectThread={(id) => {
                  const hit = mine.find((x) => x.id === id);
                  if (hit) seek(hit.anchor.start);
                  onSelectThread(id);
                }}
                selecting={selecting && !playing}
                draft={draft?.rect || draft?.point ? draft : null}
                onDraft={(d) => onDraft({ ...d, time: draft?.time ?? { start: now() } })}
              />
            ) : null}
            {viewport ? renderInPage?.(viewport) : null}
          </div>
          <Timeline
            duration={duration}
            t={t}
            threads={mine}
            activeThreadId={activeThreadId}
            draft={draft?.time ?? null}
            selecting={selecting}
            onSeek={(to) => seek(to)}
            onScrub={(to) => seek(to, false)}
            onPick={(x) => {
              seek(x.anchor.start);
              onSelectThread(x.id);
            }}
            onDraftTime={(time, marking) => {
              videoRef.current?.pause();
              onDraft({ ...keepPlace(), time, ...(marking ? { marking: true } : {}) });
            }}
          />
          <div className="vplayer__bar">
            <M3eIconButton
              aria-label={playing ? "一時停止（Space）" : "再生（Space）"}
              onClick={togglePlay}
              variant="filled"
            >
              <M3eIcon name={playing ? "pause" : "play_arrow"} className="icon--filled" />
            </M3eIconButton>
            <M3eIconButton
              className="vplayer__skip"
              aria-label="5 秒戻る（J）"
              onClick={() => seek(t - 5, false)}
            >
              <M3eIcon name="replay_5" />
            </M3eIconButton>
            <M3eIconButton aria-label="1 コマ戻る（←）" onClick={() => seek(t - FRAME)}>
              <M3eIcon name="navigate_before" />
            </M3eIconButton>
            <M3eIconButton aria-label="1 コマ進む（→）" onClick={() => seek(t + FRAME)}>
              <M3eIcon name="navigate_next" />
            </M3eIconButton>
            <M3eIconButton
              className="vplayer__skip"
              aria-label="5 秒進む（L）"
              onClick={() => seek(t + 5, false)}
            >
              <M3eIcon name="forward_5" />
            </M3eIconButton>
            <span className="vplayer__time" aria-live="off">
              {formatVideoTime(t, true)} / {formatVideoTime(duration, true)}
            </span>
            <span className="spacer" />
            <M3eIconButton
              aria-label={loopRange ? "選んだ範囲を繰り返す" : "繰り返し再生"}
              toggle
              selected={loop}
              onClick={() => setLoop((l) => !l)}
            >
              <M3eIcon name="repeat" className={loop ? "icon--filled" : ""} />
            </M3eIconButton>
            <M3eButton
              variant="text"
              className="vplayer__rate"
              aria-label={`再生の速さ ${rate} 倍（変える）`}
            >
              {rate}×
              <M3eMenuTrigger htmlFor={`vrate-${artifactId}`} />
            </M3eButton>
            <M3eMenu id={`vrate-${artifactId}`} positionY="above">
              <M3eMenuItemGroup aria-label="再生の速さ">
                {SPEEDS.map((s) => (
                  <M3eMenuItemRadio
                    key={s}
                    checked={rate === s}
                    onClick={() => {
                      setRate(s);
                      if (videoRef.current) videoRef.current.playbackRate = s;
                    }}
                  >
                    {s} 倍
                  </M3eMenuItemRadio>
                ))}
              </M3eMenuItemGroup>
            </M3eMenu>
            <M3eIconButton
              aria-label={muted ? "音を出す（M）" : "消音（M）"}
              toggle
              selected={muted}
              onClick={() => setMuted((m) => !m)}
            >
              <M3eIcon name={muted ? "volume_off" : "volume_up"} />
            </M3eIconButton>
            <M3eIconButton
              aria-label={full ? "全画面をやめる（F）" : "全画面（F）"}
              onClick={toggleFull}
            >
              <M3eIcon name={full ? "fullscreen_exit" : "fullscreen"} />
            </M3eIconButton>
          </div>
          {selecting ? (
            <div className="vplayer__marks" role="group" aria-label="コメントの時点・範囲">
              <M3eButton
                variant="tonal"
                className="vplayer__comment"
                aria-label="この時点にコメント（C）"
                onClick={draft?.marking ? commitMarking : commentHere}
              >
                <M3eIcon slot="icon" name="add_comment" />
                この時点にコメント
              </M3eButton>
              <M3eButton
                variant="text"
                className="vplayer__mark"
                aria-label="範囲の始めをここにする（I）"
                onClick={markIn}
              >
                <M3eIcon slot="icon" name="first_page" />
                ここから
              </M3eButton>
              <M3eButton
                variant="text"
                className="vplayer__mark"
                aria-label="範囲の終わりをここにする（O）"
                onClick={markOut}
              >
                <M3eIcon slot="icon" name="last_page" />
                ここまで
              </M3eButton>
              {draft?.marking && draft.time ? (
                <span className="vplayer__marking" role="status">
                  {formatVideoTime(draft.time.start)} から。終わりの位置で「ここまで」（O）
                </span>
              ) : null}
              {draft?.time?.end !== undefined ? (
                <M3eButton variant="text" onClick={clearRange}>
                  <M3eIcon slot="icon" name="close" />
                  範囲を外す
                </M3eButton>
              ) : null}
            </div>
          ) : null}
        </div>
        {viewport && renderGutter ? renderGutter(viewport) : null}
      </div>
    </div>
  );
}

/**
 * タイムライン: 上の段にコメントの印（時点は番号の丸、範囲は帯）と選んでいる範囲、下に再生位置のつまみ（M3 Sliders の見た目）。
 * - 上の段をドラッグすると範囲を選ぶ（スマホも指でそのまま）。動かさずに離すとその時点
 * - 下の段を押す・ドラッグすると再生位置を移す。Shift を押しながらドラッグしても範囲を選べる
 * - 選んでいる範囲は両端のつまみをドラッグ、またはつまみにフォーカスして ← →（Shift で 1 秒）で直せる
 */
function Timeline({
  duration,
  t,
  threads,
  activeThreadId,
  draft,
  selecting,
  onSeek,
  onScrub,
  onPick,
  onDraftTime,
}: {
  duration: number;
  t: number;
  threads: (OverlayThread & { anchor: VideoAnchor })[];
  activeThreadId: string | null;
  draft: { start: number; end?: number } | null;
  selecting: boolean;
  onSeek: (t: number) => void;
  onScrub: (t: number) => void;
  onPick: (x: OverlayThread & { anchor: VideoAnchor }) => void;
  /** marking: なぞっている途中（離すまで投稿欄を出さない） */
  onDraftTime: (time: { start: number; end?: number }, marking?: boolean) => void;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  /** ドラッグ中: 範囲を作る（from が起点）か、範囲の端を動かす */
  const drag = useRef<
    | { kind: "range"; id: number; from: number; moved: boolean }
    | { kind: "edge"; id: number; edge: "start" | "end" }
    | { kind: "scrub"; id: number }
    | null
  >(null);
  const pct = (v: number) => (duration > 0 ? `${(clamp(v, 0, duration) / duration) * 100}%` : "0%");
  const timeAt = (clientX: number) => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || duration <= 0) return 0;
    return roundVideoTime(clamp((clientX - r.left) / r.width, 0, 1) * duration);
  };

  // 印を段に分ける（重なる帯・番号は下の段へ）。幅の目安は全体の 4%
  const minSpan = duration * 0.04;
  const rows: number[] = [];
  const placed = [...threads]
    .sort((a, b) => a.anchor.start - b.anchor.start)
    .map((x) => {
      const from = x.anchor.start;
      const to = Math.max(x.anchor.end ?? from, from + minSpan);
      // 端が接する帯・番号も重ならないよう、前の印の終わりから少し空いていれば同じ段
      let row = rows.findIndex((endAt) => endAt + minSpan / 2 <= from);
      if (row < 0) row = rows.length;
      rows[row] = to;
      return { x, row };
    });
  const rowCount = Math.max(1, rows.length);

  const startDrag = (e: PointerEvent<HTMLDivElement>, kind: "range" | "scrub") => {
    if (e.button !== 0 || duration <= 0) return;
    const at = timeAt(e.clientX);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (kind === "range") {
      drag.current = { kind, id: e.pointerId, from: at, moved: false };
      onDraftTime({ start: at }, true);
      onSeek(at);
    } else {
      drag.current = { kind, id: e.pointerId };
      onScrub(at);
    }
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) {
      if (e.pointerType === "mouse") setHover(timeAt(e.clientX));
      return;
    }
    const at = timeAt(e.clientX);
    if (d.kind === "scrub") onScrub(at);
    else if (d.kind === "range") {
      if (Math.abs(at - d.from) < 0.05 && !d.moved) return;
      d.moved = true;
      onDraftTime({ start: Math.min(d.from, at), end: Math.max(d.from, at) }, true);
    } else if (draft) {
      const s = d.edge === "start" ? Math.min(at, (draft.end ?? at) - 0.05) : draft.start;
      const en = d.edge === "end" ? Math.max(at, draft.start + 0.05) : draft.end;
      onDraftTime({ start: Math.max(0, s), ...(en !== undefined ? { end: en } : {}) });
      onScrub(d.edge === "start" ? s : (en ?? s));
    }
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.kind === "range") {
      const at = timeAt(e.clientX);
      // 離したら投稿欄を出す（動かさずに離したらその時点）
      onDraftTime(
        d.moved && Math.abs(at - d.from) >= 0.05
          ? { start: Math.min(d.from, at), end: Math.max(d.from, at) }
          : { start: d.from },
      );
      onSeek(d.moved ? Math.min(d.from, at) : d.from);
    }
  };

  const edgeKeys = (edge: "start" | "end") => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!draft || draft.end === undefined) return;
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 1 : FRAME) * dir;
    const next =
      edge === "start"
        ? { start: clamp(draft.start + step, 0, draft.end - 0.05), end: draft.end }
        : { start: draft.start, end: clamp(draft.end + step, draft.start + 0.05, duration) };
    onDraftTime({ start: roundVideoTime(next.start), end: roundVideoTime(next.end) });
    onSeek(edge === "start" ? next.start : next.end);
  };

  return (
    <div className="vtl">
      <div
        ref={laneRef}
        className={`vtl__lane ${selecting ? "vtl__lane--select" : ""}`}
        style={{ height: rowCount * 24 + 8 }}
        {...(selecting
          ? {
              onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
                if ((e.target as Element).closest(".vtl__mark, .vtl__edge")) return;
                startDrag(e, "range");
              },
              onPointerMove: moveDrag,
              onPointerUp: endDrag,
              onPointerCancel: () => {
                drag.current = null;
                if (draft) onDraftTime(draft);
              },
              title: "ドラッグで範囲を選ぶ",
            }
          : {})}
      >
        {placed.map(({ x, row }) => {
          const a = x.anchor;
          const name = `${overlayLabel(x)}（${formatVideoSpan(a)}）`;
          const cls = `vtl__mark ${x.kind === "feedback" ? "vtl__mark--fb" : ""} ${x.id === activeThreadId ? "vtl__mark--active" : ""}`;
          return (
            <div key={x.id} className="vtl__item" style={{ top: row * 24 + 4 }}>
              {a.end !== undefined ? (
                <span
                  className={`vtl__bar ${x.kind === "feedback" ? "vtl__bar--fb" : ""} ${x.id === activeThreadId ? "vtl__bar--active" : ""}`}
                  style={{ left: pct(a.start), width: `calc(${pct(a.end)} - ${pct(a.start)})` }}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                className={cls}
                style={{ left: pct(a.start) }}
                aria-label={name}
                title={name}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPick(x)}
              >
                {x.index}
              </button>
            </div>
          );
        })}
        {draft ? (
          <>
            {draft.end !== undefined ? (
              <span
                className="vtl__draft"
                style={{
                  left: pct(draft.start),
                  width: `calc(${pct(draft.end)} - ${pct(draft.start)})`,
                }}
                aria-hidden="true"
              />
            ) : (
              <span
                className="vtl__draft-point"
                style={{ left: pct(draft.start) }}
                aria-hidden="true"
              />
            )}
            {draft.end !== undefined
              ? (["start", "end"] as const).map((edge) => (
                  <div
                    key={edge}
                    className={`vtl__edge vtl__edge--${edge}`}
                    style={{ left: pct(edge === "start" ? draft.start : draft.end!) }}
                    role="slider"
                    tabIndex={0}
                    aria-label={edge === "start" ? "範囲の始め" : "範囲の終わり"}
                    aria-valuemin={0}
                    aria-valuemax={roundVideoTime(duration)}
                    aria-valuenow={edge === "start" ? draft.start : draft.end!}
                    aria-valuetext={formatVideoTime(
                      edge === "start" ? draft.start : draft.end!,
                      true,
                    )}
                    onKeyDown={edgeKeys(edge)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      laneRef.current?.setPointerCapture(e.pointerId);
                      drag.current = { kind: "edge", id: e.pointerId, edge };
                    }}
                  />
                ))
              : null}
          </>
        ) : null}
        {selecting && threads.length === 0 && !draft ? (
          <span className="vtl__hint" aria-hidden="true">
            なぞって範囲を選ぶ
          </span>
        ) : null}
        <span className="vtl__cursor" style={{ left: pct(t) }} aria-hidden="true" />
      </div>
      <div
        className="vtl__track"
        role="slider"
        tabIndex={0}
        aria-label="再生位置"
        aria-valuemin={0}
        aria-valuemax={roundVideoTime(duration)}
        aria-valuenow={roundVideoTime(t)}
        aria-valuetext={`${formatVideoTime(t)} / ${formatVideoTime(duration)}`}
        onPointerDown={(e) => startDrag(e, e.shiftKey && selecting ? "range" : "scrub")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
      >
        <span className="vtl__inactive" />
        <span className="vtl__active" style={{ width: pct(t) }} />
        <span className="vtl__thumb" style={{ left: pct(t) }} />
        {hover !== null ? (
          <span className="vtl__hover" style={{ left: pct(hover) }}>
            {formatVideoTime(hover)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
