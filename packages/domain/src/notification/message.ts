import { notificationPath, type PushPayload, pushTagOf } from "./push.ts";

/*
 * 外に出す通知の内容（端末・登録メールアドレス・Slack の DM で共通）。外に出す文面を作るのはこのファイルだけ。
 * 内容のポリシーの判断は composeNotificationMessage で一度だけ行い、経路ごとの形（toPushPayload・toEmail・toSlackText）は
 * その結果を描くだけにする（ある経路だけが伏せた内容を出すことが無いように）。
 */

/**
 * 外に出す内容（ポリシー値。運用で変えられるよう外出しする）。
 * - showWorkTitle: 題名・本文に制作物名を載せるか。false なら決まった文言だけ
 * - showPreview: 送り主と抜粋（コメントの冒頭など）を載せるか。false なら決まった題名（「新しい通知」）と制作物名だけ。
 *   利用者ごとの「通知に内容を表示」（NotificationPrefs.showPreview）も true のときだけ載せる
 * - showDetail: メール・Slack にアプリ内の通知の本文を載せるか（端末の通知には場所が無いので載せない）。
 *   無ければ載せない（端末だけだったころの値で本文が出ないように）
 * 伏せた通知（今は見られない制作物）の内容は、これらの値にかかわらず載せない。
 */
export interface NotificationContentPolicy {
  showWorkTitle: boolean;
  showPreview: boolean;
  showDetail?: boolean;
}

export const DEFAULT_NOTIFICATION_CONTENT_POLICY: NotificationContentPolicy = {
  showWorkTitle: true,
  showPreview: true,
  showDetail: true,
};

/**
 * どこまで出したか。
 * - hidden: 今は見られない制作物の通知（決まった文言・行き先は "/"）
 * - withheld: 利用者かポリシーが内容の表示を止めている（「新しい通知」と制作物名だけ）
 * - full: 送り主・抜粋（と、許されていれば本文）まで
 */
export type Disclosure = "hidden" | "withheld" | "full";

/** 経路によらない「外に出す内容」 */
export interface NotificationMessage {
  id: string;
  disclosure: Disclosure;
  /** 『制作物』 / 通知の題名（非公開・制作物なし） / 「新しい通知」（伏せる・内容を出さない） */
  title: string;
  /** 「送り主: 抜粋」など（端末の通知の本文と同じ規則） */
  summary: string;
  /**
   * アプリ内の通知の本文。disclosure が full で、ポリシーが showWorkTitle・showDetail のときだけ
   * （本文は「『作品名』第2版・誰: …」の形で作品名を含むので、showWorkTitle も条件）
   */
  detail: string | null;
  /** アプリ内の行き先（notificationPath。伏せた通知は "/"） */
  path: string;
  tag: string;
  createdAt: number;
}

/** 端末の通知の題名・本文の長さの上限（文字数。ロック画面と、暗号化した本文の大きさの上限に収める）。メール・Slack の行も同じ */
export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 120;
const EMAIL_SUBJECT_MAX = 120;
const EMAIL_DETAIL_MAX = 2000;
const SLACK_DETAIL_MAX = 1000;

/** 空白・改行を 1 つの空白につめ、長ければ切って「…」を付ける（サロゲートペアを割らない） */
export function clipPushText(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

/**
 * 通知 1 件の外に出す内容を決める（切り詰めは経路ごとの形で行う）。
 * - 題名は制作物名（『…』。LINE の相手・Slack のチャンネルにあたる）。制作物の無い通知は通知の題名
 * - 要約は「送り主: 抜粋」。どちらか無ければある方だけ（両方無ければ通知の題名）
 * - 利用者かポリシーが内容の表示を止めているときは、題名を「新しい通知」にし、要約は制作物名だけにする
 * - 今は見られない制作物の通知（hidden）は決まった文言にする
 */
export function composeNotificationMessage(input: {
  notification: {
    id: string;
    kind: string;
    title: string;
    body: string;
    workId?: string;
    revisionId?: string;
    threadId?: string;
    createdAt?: number;
    /** 載せてよい短い抜粋（notify が作る。伏せた通知には無い） */
    preview?: string;
  };
  /** 通知の制作物（今その人が見られるときだけ渡す。見られない・制作物の無い通知は null） */
  work: { title: string } | null;
  /** 制作物の通知なのに、今その人が見られない */
  hidden: boolean;
  /** 送り主の表示名（分からなければ null） */
  actorName?: string | null;
  /** 利用者の「通知に内容を表示」（既定は true） */
  showPreview?: boolean;
  policy?: NotificationContentPolicy;
}): NotificationMessage {
  const policy = input.policy ?? DEFAULT_NOTIFICATION_CONTENT_POLICY;
  const n = input.notification;
  const base = { id: n.id, createdAt: n.createdAt ?? 0 };
  if (input.hidden)
    return {
      ...base,
      disclosure: "hidden",
      title: "新しい通知",
      summary: "校正システムを開いて確かめてください",
      detail: null,
      path: "/",
      tag: n.id,
    };
  const at = { ...base, path: notificationPath(n), tag: pushTagOf(n) };
  const workName =
    input.work === null ? null : policy.showWorkTitle ? `『${input.work.title}』` : null;
  if (!policy.showPreview || input.showPreview === false)
    return {
      ...at,
      disclosure: "withheld",
      title: "新しい通知",
      summary: workName ?? "校正システム",
      detail: null,
    };
  const who = input.actorName?.trim() || null;
  const text = n.preview?.trim() || null;
  // 題名が通知の題名のときは、要約で同じ文言を繰り返さない
  const event = workName === null ? null : n.title;
  const summary = text
    ? who
      ? `${who}: ${text}`
      : text
    : who
      ? event
        ? `${who}: ${event}`
        : who
      : (event ?? "校正システム");
  return {
    ...at,
    disclosure: "full",
    title: workName ?? n.title,
    summary,
    detail: policy.showWorkTitle && policy.showDetail ? n.body.trim() || null : null,
  };
}

/** 端末: 題名は 80 字・本文（summary）は 120 字まで。detail は載せない */
export function toPushPayload(m: NotificationMessage, unread: number): PushPayload {
  return {
    id: m.id,
    badge: Math.max(0, Math.floor(unread)),
    createdAt: m.createdAt,
    tag: m.tag,
    url: m.path,
    title: clipPushText(m.title, PUSH_TITLE_MAX),
    body: clipPushText(m.summary, PUSH_BODY_MAX),
  };
}

/** メールの内容（テキストだけ。HTML は送らない） */
export interface EmailContent {
  subject: string;
  text: string;
}

/**
 * subject: title と summary を 1 行に（120 字まで。CR・LF を含めない。ヘッダーに入るため）
 * text: summary / detail（あれば 2000 字まで）/ `${origin}${path}` / アカウントメニューの「通知の設定」を案内する決まった結び
 */
export function toEmail(m: NotificationMessage, origin: string): EmailContent {
  const detail = m.detail === null ? [] : [clipPushText(m.detail, EMAIL_DETAIL_MAX)];
  return {
    subject: clipPushText(`${m.title} ${m.summary}`, EMAIL_SUBJECT_MAX),
    text: [
      clipPushText(m.summary, PUSH_BODY_MAX),
      ...detail,
      `${origin}${m.path}`,
      EMAIL_FOOTER,
    ].join("\n\n"),
  };
}

const EMAIL_FOOTER =
  "校正システムからの通知です。届け先と載せる内容は、アカウントメニューの「通知の設定」で変えられます。";

/**
 * `*title*` / summary / `>detail`（あれば 1000 字まで）/ `<${origin}${path}|校正システムで開く>`。
 * 差し込む値はすべて & < > を逃がす（コメントの文面から <!channel>・<@U…>・リンクを作らせない）
 */
export function toSlackText(m: NotificationMessage, origin: string): string {
  const lines = [`*${slackField(m.title, PUSH_TITLE_MAX)}*`, slackField(m.summary, PUSH_BODY_MAX)];
  if (m.detail !== null) lines.push(`>${slackField(m.detail, SLACK_DETAIL_MAX)}`);
  lines.push(`<${slackEscape(`${origin}${m.path}`)}|校正システムで開く>`);
  return lines.join("\n");
}

/** 切ってから逃がす（先に逃がすと &amp; などが途中で切れうる） */
function slackField(text: string, max: number): string {
  return slackEscape(clipPushText(text, max));
}

function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
