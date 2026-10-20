import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { EditorPrefetch } from "@/features/editor/EditorPrefetch";
import { SubmitPicker, useSubmitLauncher, useSubmitTargets } from "@/features/home/SubmitPicker";
import { NotificationsBell } from "@/features/notifications/NotificationsBell";
import { saveData, warmPdfAssets, whenIdle } from "@/lib/preload";
import { setAppBadge, useInstallPrompt } from "@/lib/pwa";
import { NotificationPrompt } from "@/features/notifications/NotificationPrompt";
import { usePushAvailable } from "@/features/notifications/useDevicePush";
import { disablePush } from "@/lib/push";
import { useWindowClass } from "@/lib/useMedia";
import { M3eAppBar } from "@m3e/react/app-bar";
import { M3eFab } from "@m3e/react/fab";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
import { M3eNavBar, M3eNavItem } from "@m3e/react/nav-bar";
import { M3eNavRail } from "@m3e/react/nav-rail";
import { ActionSheet } from "@/ui/ActionSheet";
import { AvatarProvider } from "@/ui/AvatarProvider";
import { UserAvatar } from "@/ui/UserAvatar";

export const Route = createFileRoute("/_app")({ component: AppLayout });

/** 画面に出ている人のアバターの設定（Humation）をまとめて引く Provider で包む（§56） */
function AppLayout() {
  return (
    <AvatarProvider>
      <AppShell />
    </AvatarProvider>
  );
}

/** アバターを変える（初めて開くまで読み込まない。Humation のアセットは UserAvatar と同じく遅延） */
const AvatarPickerDialog = lazy(() =>
  import("@/features/account/AvatarPickerDialog").then((m) => ({ default: m.AvatarPickerDialog })),
);

/** 通知の設定（この端末への通知。初めて開くまで読み込まない） */
const PushSettingDialog = lazy(() =>
  import("@/features/notifications/PushSettingDialog").then((m) => ({
    default: m.PushSettingDialog,
  })),
);

const RAIL_KEY = "mf100.rail.expanded";
const readRailPref = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * 認証ガード＋共通レイアウト。M3 のウィンドウサイズクラスで骨格を切り替える（Layout › Window size classes）。
 * - compact（<600）: アプリバーは見出し・通知・アカウント。下部ナビゲーションバー（制作・校正・制作物の 3 つ）。
 *   表記ルールと管理（管理者）はアカウントのメニューへ。ホームは無く、制作と校正がそれぞれホーム（利用者決定 2026-10-19）。
 *   エディタ（`/works/:id`）では下部バーを隠す（詳細画面）。アプリバーはどの幅でも 1 本で、エディタが戻る・題名・操作を差し込む。
 * - medium（600–839）/ expanded（840–1199）: 折りたたみレール（96）。メニューを押すと**モーダル**の展開レールが重なる（スクリム、Esc で閉じる）。
 * - large（1200 以上）: メニューで**標準**の展開レール（220）に広がり内容を押す。状態は保存。既定は折りたたみ。
 * レールの中身は M3 の解剖図どおり: 上にメニュー、次に FAB「作る」、その下に行き先（制作・校正・制作物）、レールの下に
 * 表記ルール（・管理）。アカウントは右上に残す。
 * FAB は普段のメンバーの主な操作「版の提出」（§36 L-15。利用者決定 2026-10-15）と「新しく書く」の 2 つを開く。compact はレールが無いので、
 * 制作の右下（下部ナビの上 16）に同じ FAB を出す。提出できる制作物が無い人には出さない。制作物の登録は制作物のアプリバー（登録権限のある人だけ）。
 * 通知は独立した画面を持たず、アカウントの隣のベルのパネル（compact はボトムシート）から対象へ飛ぶ。
 */
function AppShell() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  /** 校正のナビのバッジ（自分の手が要る数）。割当・専門確認だけを読む軽い問い合わせ（dashboard.get ではない） */
  const checkTodo = useQuery(api.dashboard.checkBadge, me ? {} : "skip")?.count ?? 0;
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const { signOut } = useAuthActions();
  const unsubscribePush = useMutation(api.push.unsubscribe);
  const stopPushOnThisDevice = async () => {
    const endpoint = await disablePush().catch(() => null);
    if (endpoint) await unsubscribePush({ endpoint }).catch(() => undefined);
  };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const cls = useWindowClass();
  const [railPref, setRailPref] = useState(readRailPref);
  const [modalOpen, setModalOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  /** large の下の階層で、一時的にレールを広げたか（画面を移ると折りたたみに戻る） */
  const [subOpen, setSubOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);
  /** 「アバターを変える」。一度開いたら描いたままにする（閉じるアニメーションと 2 回目をすぐ開くため） */
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarMounted, setAvatarMounted] = useState(false);
  /** 「通知の設定」。アバターと同じく一度開いたら描いたままにする */
  const [pushOpen, setPushOpen] = useState(false);
  const [pushMounted, setPushMounted] = useState(false);
  // 端末への通知が使える環境・端末のときだけ、アカウントに「通知の設定」を出す（サインイン後に問い合わせる）
  const pushAvailable = usePushAvailable(isAuthenticated && me != null);
  const submitTargets = useSubmitTargets();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** FAB「作る」のボトムシート（compact）。medium 以上はメニュー */
  const [fabSheet, setFabSheet] = useState(false);
  const launcher = useSubmitLauncher();

  // 下部ナビの実際の高さ（セーフエリアを除く）を --mf-navbar-h に入れる。決め打ちの 80 だと、文字の大きさ（iOS の Dynamic Type）で
  // 変わる高さとずれ、ナビの上に置くもの（版を提出の FAB）との間に隙間や重なりができる
  useEffect(() => {
    if (cls !== "compact") return;
    const bar = document.querySelector<HTMLElement>(".shell__bar");
    if (!bar) return;
    const root = document.documentElement;
    const sync = () => {
      const pad = parseFloat(getComputedStyle(bar).paddingBottom) || 0;
      root.style.setProperty(
        "--mf-navbar-h",
        `${Math.round(bar.getBoundingClientRect().height - pad)}px`,
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--mf-navbar-h");
    };
  }, [cls, me?.id, path]);
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || me === null) void navigate({ to: "/signin", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);
  // 最初の画面が落ち着いたら、下部ナビ・レールの行き先の画面のコードを先に読み込む（画面ごとに分けた分、押したときに
  // 取りに行くと待たせる。ホバーでの先読み（defaultPreload: intent）はスマホでは効かない）。校正画面（制作物を開いた画面）は
  // 大きいので少し遅らせて 2 段目に。通信量の節約（Data Saver）では行わない。docs/UI_M3E.md §60
  const meId = me?.id;
  useEffect(() => {
    if (!meId || saveData()) return;
    const quiet = () => undefined;
    const cancelFirst = whenIdle(() => {
      warmPdfAssets();
      for (const to of ["/make", "/check", "/works", "/notation", "/write"] as const)
        void router.preloadRoute({ to }).catch(quiet);
    }, 4000);
    let cancelSecond: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      cancelSecond = whenIdle(
        () =>
          void router
            .preloadRoute({ to: "/works/$workId", params: { workId: "preload" } })
            .catch(quiet),
        4000,
      );
    }, 3000);
    return () => {
      cancelFirst();
      window.clearTimeout(timer);
      cancelSecond?.();
    };
  }, [meId, router]);

  // モーダルの展開レールは、行き先を選んだ時・幅が変わった時・Esc で閉じる
  useEffect(() => {
    setModalOpen(false);
    setNotifOpen(false);
    setSubOpen(false);
  }, [path, cls]);
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // アプリの枠（me）が届くまでは何も描かない。ただし校正画面を開くときは、その間にファイルの先取りを始める（EditorPrefetch）
  if (isLoading || !isAuthenticated || !me)
    return isLoading || !isAuthenticated ? null : <EditorPrefetch path={path} />;

  const items = [
    // 入口は仕事で分ける（利用者決定 2026-10-19）: 制作 = 自分が作るもの、校正 = 自分が確かめるもの。どちらもホーム
    { to: "/make", icon: "edit", label: "制作" },
    { to: "/check", icon: "fact_check", label: "校正" },
    { to: "/works", icon: "folder", label: "制作物" },
  ];
  // たまに使う行き先。下部ナビには置かず、アカウントのメニューへ（広い画面ではレールの下にも）
  const lowerItems = [
    { to: "/notation", icon: "spellcheck", label: "表記ルール" },
    ...(me.isSystemAdmin ? [{ to: "/admin", icon: "admin_panel_settings", label: "管理" }] : []),
  ];
  // 文章・投稿のエディタ（/works/:id/write・/post）と書く制作物の選択（/write）を開いているあいだは、入口の「制作」を選択中にする
  const writing = /^\/works\/[^/]+\/(write|post)$/.test(path);
  const selected = (to: string) =>
    to === "/make"
      ? path === "/make" || path === "/write" || writing
      : to === "/works"
        ? !writing && (path === to || path.startsWith(`${to}/`))
        : path === to || path.startsWith(`${to}/`);
  // 項目は M3eNavItem だけ（ボタン）にし、押したらルーターで移る。外側に <a> を重ねると 1 項目に 2 回止まり、
  // 読み上げも「リンク › ボタン」と入れ子になる。M3eNavItem の href は中に <a> を作り、同じく入れ子になる（§35 A-10）
  const navItems = (list: typeof items = items, lower = false) =>
    list.map((it, i) => (
      <M3eNavItem
        key={it.to}
        className={lower ? `rail__lower ${i === 0 ? "rail__lower--first" : ""}` : ""}
        selected={selected(it.to)}
        data-to={it.to}
        aria-label={
          it.to === "/check" && checkTodo > 0 ? `${it.label}（やること ${checkTodo} 件）` : it.label
        }
        title={it.label}
        onClick={() => void navigate({ to: it.to })}
      >
        {it.to === "/check" && checkTodo > 0 ? (
          <span slot="icon" className="nav-icon">
            <M3eIcon name={it.icon} className={selected(it.to) ? "icon--filled" : ""} />
            <span className="badge">{checkTodo > 99 ? "99+" : checkTodo}</span>
          </span>
        ) : (
          <M3eIcon slot="icon" name={it.icon} className={selected(it.to) ? "icon--filled" : ""} />
        )}
        <span className="nav-label">{it.label}</span>
      </M3eNavItem>
    ));
  /** M3E は押した項目を自動で選択状態にするため、経路に基づく選択へ戻す */
  const resync = (e: { currentTarget: EventTarget | null }) => {
    const root = e.currentTarget as HTMLElement | null;
    root?.querySelectorAll<HTMLElement & { selected: boolean }>("m3e-nav-item").forEach((el) => {
      el.selected = el.dataset.to ? selected(el.dataset.to) : false;
    });
  };

  // 下の階層（制作物を開いた画面: 校正画面・文章エディタ・SNS 投稿の編集）。戻る矢印で上へ戻れるので、
  // M3 Breakpoints「下の階層ではレールを隠してよい／large では折りたたむ」に従い紙面を広くする（§35 L-13。利用者決定 2026-10-15）
  const editorRoute = /^\/works\/[^/]+/.test(path);
  const hideRail = editorRoute && (cls === "medium" || cls === "expanded");
  // M3 Breakpoints「置き換えられる部品」: compact/medium/expanded はモーダル展開レール、large 以上は標準展開レール
  const expandable = cls !== "compact";
  const railExpanded = cls === "large" ? (editorRoute ? subOpen : railPref) : modalOpen;
  const toggleRail = () => {
    if (cls === "large" && editorRoute) setSubOpen((o) => !o);
    else if (cls === "large") {
      const next = !railPref;
      setRailPref(next);
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {}
    } else setModalOpen((o) => !o);
  };
  const canSubmit = (submitTargets?.length ?? 0) > 0;
  // 作る操作: 版を提出（提出できる制作物を選ぶ）と、新しく書く（書く制作物を選ぶ）
  const makeActions = [
    { icon: "upload_file", label: "版を提出", onSelect: () => setPickerOpen(true) },
    { icon: "edit_document", label: "新しく書く", onSelect: () => void navigate({ to: "/write" }) },
  ];
  const makeFab = (className?: string) => (
    <M3eFab
      size="small"
      aria-label="作る"
      title="作る"
      className={className ?? ""}
      {...(cls === "compact" ? { extended: true, onClick: () => setFabSheet(true) } : {})}
    >
      <M3eIcon name="add" />
      <span slot="label">作る</span>
      {cls === "compact" ? null : <M3eMenuTrigger htmlFor="make-menu" />}
    </M3eFab>
  );
  const modal = cls !== "large" && cls !== "compact" && modalOpen;
  // compact のエディタは詳細画面: 下部バーを隠す（M3 list-detail の compact）
  const immersive = cls === "compact" && editorRoute;
  // compact はレールが無いので、制作の右下に FAB（下部ナビの上 16。M3 FAB › Placement）
  const mobileFab = cls === "compact" && canSubmit && path === "/make";
  // compact の「操作」はボトムシート、medium 以上はメニュー（M3 Breakpoints › Overview の表。§35 L-09）
  const account = (size: number, className?: string) => (
    <M3eIconButton
      slot="trailing"
      aria-label={`アカウント: ${me.name}`}
      className={className ?? ""}
      {...(cls === "compact" ? { onClick: () => setAccountSheet(true) } : {})}
    >
      <UserAvatar seed={me.email ?? me.id} userId={me.id} config={me.avatar} size={size} />
      {cls === "compact" ? null : <M3eMenuTrigger htmlFor="account-menu" />}
    </M3eIconButton>
  );
  const accountActions = [
    // 自分のアバター（Humation）を選ぶ（利用者指示 2026-10-17）
    {
      icon: "face",
      label: "アバターを変える",
      onSelect: () => {
        setAvatarMounted(true);
        setAvatarOpen(true);
      },
    },
    // 端末への通知（Web Push）のオン・オフ。以前は通知パネルの一番上にあった（利用者指示 2026-10-17）
    ...(pushAvailable
      ? [
          {
            icon: "notifications",
            label: "通知の設定",
            onSelect: () => {
              setPushMounted(true);
              setPushOpen(true);
            },
          },
        ]
      : []),
    // 表記ルールと管理は下部ナビに置かない（利用者決定 2026-10-19）ので、アカウントのメニューから開く
    ...lowerItems.map((it) => ({
      icon: it.icon,
      label: it.label,
      onSelect: () => void navigate({ to: it.to }),
    })),
    ...(install
      ? [
          {
            icon: "install_desktop",
            label: "アプリとしてインストール",
            onSelect: () => void install(),
          },
        ]
      : []),
    {
      icon: "logout",
      label: "サインアウト",
      onSelect: () =>
        // 共用の端末で次の人に前の人の通知を出さないよう、この端末への通知をやめてからサインアウトする
        void stopPushOnThisDevice()
          .then(() => signOut())
          .then(() => {
            setAppBadge(0); // 別の人がサインインしたときに前の人の件数を残さない
            return navigate({ to: "/signin" });
          }),
    },
  ];

  return (
    <div
      className={`shell ${modal ? "shell--modal" : ""} ${immersive ? "shell--immersive" : ""} ${editorRoute ? "shell--editor" : ""} ${hideRail ? "shell--norail" : ""} ${mobileFab ? "shell--fab" : ""}`}
    >
      <div className="shell__nav" hidden={hideRail}>
        {modal ? (
          <div className="shell__scrim" onClick={() => setModalOpen(false)} aria-hidden="true" />
        ) : null}
        <M3eNavRail
          id="app-rail"
          mode={railExpanded ? "expanded" : "compact"}
          className={`shell__rail ${modal ? "shell__rail--modal" : ""} ${railExpanded ? "" : "shell__rail--collapsed"}`}
          aria-label="主要ナビゲーション"
          onChange={resync}
        >
          {expandable ? (
            <M3eIconButton
              aria-label={railExpanded ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={railExpanded}
              aria-controls="app-rail"
              onClick={toggleRail}
            >
              <M3eIcon name={railExpanded ? "menu_open" : "menu"} />
            </M3eIconButton>
          ) : null}
          {canSubmit ? makeFab() : null}
          {navItems()}
          {navItems(lowerItems, true)}
        </M3eNavRail>
      </div>
      {/* モーダルの展開レールを開いている間は、後ろを Tab で選べないようにする（§35 A-06） */}
      <div className="shell__main" inert={modal}>
        {/* アプリバーは 1 本。画面ごとの見出し・戻る・操作は AppBarSlot で差し込む（M3 App bars）。全体の操作（通知・アカウント）は末尾 */}
        <M3eAppBar size="small" className="shell__appbar">
          <span slot="leading" id="appbar-leading" className="appbar-slot" />
          <span
            slot="title"
            id="appbar-title"
            className="appbar-slot appbar-slot--title"
            role="heading"
            aria-level={1}
          />
          <span
            slot="subtitle"
            id="appbar-subtitle"
            className="appbar-slot appbar-slot--subtitle"
          />
          <span slot="trailing" id="appbar-actions" className="appbar-slot appbar-slot--actions" />
          {/* 通知はアカウントの隣（利用者指示 2026-10-14「アイコンの横が相場」）。compact はボトムシート。
              ただしスマホの詳細画面（制作物を開いた画面）では、Google ドキュメント・Chat などと同じくベルとアバターを出さず、
              見出し（制作物名）と画面の操作に幅を譲る（§35 L-14。利用者決定 2026-10-15） */}
          {immersive ? null : cls === "compact" ? (
            <NotificationsBell.Bell onOpen={() => setNotifOpen(true)} />
          ) : (
            <NotificationsBell.Bell menuId="notif-menu" />
          )}
          {immersive ? null : account(32, "shell__account")}
        </M3eAppBar>
        <NotificationsBell.AppBadge />
        <NotificationPrompt />
        {cls === "compact" ? (
          <NotificationsBell.Sheet open={notifOpen} onClose={() => setNotifOpen(false)} />
        ) : (
          <NotificationsBell.Menu id="notif-menu" />
        )}
        {cls === "compact" ? (
          <ActionSheet
            open={accountSheet}
            onClose={() => setAccountSheet(false)}
            title={me.email ? `${me.name}（${me.email}）` : me.name}
            items={accountActions}
          />
        ) : (
          <M3eMenu id="account-menu" positionX="before">
            <div className="account-menu__header">
              <span aria-hidden="true">
                <UserAvatar seed={me.email ?? me.id} userId={me.id} config={me.avatar} size={40} />
              </span>
              <div>
                <div className="label-large">{me.name}</div>
                {me.email ? <div className="small muted">{me.email}</div> : null}
              </div>
            </div>
            {accountActions.map((a) => (
              <M3eMenuItem key={a.label} onClick={a.onSelect}>
                <M3eIcon slot="icon" name={a.icon} />
                {a.label}
              </M3eMenuItem>
            ))}
          </M3eMenu>
        )}

        <main className="shell__content">
          <Outlet />
        </main>
        {mobileFab ? <div className="submit-fab">{makeFab()}</div> : null}
        {canSubmit && cls !== "compact" ? (
          <M3eMenu id="make-menu" positionX="after">
            {makeActions.map((a) => (
              <M3eMenuItem key={a.label} onClick={a.onSelect}>
                <M3eIcon slot="icon" name={a.icon} />
                {a.label}
              </M3eMenuItem>
            ))}
          </M3eMenu>
        ) : null}
        {cls === "compact" && canSubmit ? (
          <ActionSheet
            open={fabSheet}
            onClose={() => setFabSheet(false)}
            title="作る"
            items={makeActions}
          />
        ) : null}
        {canSubmit || pickerOpen ? (
          <SubmitPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            targets={submitTargets ?? []}
            onPick={launcher.start}
          />
        ) : null}
        {launcher.element}
        {avatarMounted ? (
          <Suspense fallback={null}>
            <AvatarPickerDialog open={avatarOpen} onClose={() => setAvatarOpen(false)} me={me} />
          </Suspense>
        ) : null}
        {pushMounted ? (
          <Suspense fallback={null}>
            <PushSettingDialog open={pushOpen} onClose={() => setPushOpen(false)} />
          </Suspense>
        ) : null}
      </div>
      {cls === "compact" && !immersive ? (
        <M3eNavBar className="shell__bar" aria-label="主要ナビゲーション" onChange={resync}>
          {/* 下部ナビは 5 項目まで（M3 Navigation bar）。制作・校正・制作物の 3 つ。表記ルールと管理はアカウントのシートへ */}
          {navItems()}
        </M3eNavBar>
      ) : null}
    </div>
  );
}
