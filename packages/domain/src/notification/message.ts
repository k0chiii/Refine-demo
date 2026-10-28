import type { PushPayload } from "./push.ts";

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
 * 非公開（restricted）の制作物の名前・送り主・抜粋・本文と、伏せた通知（今は見られない制作物）の内容は、これらの値にかかわらず載せない。
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
 * - restricted: 非公開の制作物（通知の題名と「非公開の制作物」だけ）
 * - withheld: 利用者かポリシーが内容の表示を止めている（「新しい通知」と制作物名だけ）
 * - full: 送り主・抜粋（と、許されていれば本文）まで
 */
export type Disclosure = "hidden" | "restricted" | "withheld" | "full";

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

/** 通知 1 件の外に出す内容を決める（切り詰めは経路ごとの形で行う） */
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
  work: { title: string; restricted: boolean } | null;
  /** 制作物の通知なのに、今その人が見られない */
  hidden: boolean;
  /** 送り主の表示名（分からなければ null） */
  actorName?: string | null;
  /** 利用者の「通知に内容を表示」（既定は true） */
  showPreview?: boolean;
  policy?: NotificationContentPolicy;
}): NotificationMessage {
  void input;
  throw new Error("not implemented");
}

/** 端末: 題名は 80 字・本文（summary）は 120 字まで。detail は載せない */
export function toPushPayload(m: NotificationMessage, unread: number): PushPayload {
  void [m, unread];
  throw new Error("not implemented");
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
  void [m, origin];
  throw new Error("not implemented");
}

/**
 * `*title*` / summary / `>detail`（あれば 1000 字まで）/ `<${origin}${path}|校正システムで開く>`。
 * 差し込む値はすべて & < > を逃がす（コメントの文面から <!channel>・<@U…>・リンクを作らせない）
 */
export function toSlackText(m: NotificationMessage, origin: string): string {
  void [m, origin];
  throw new Error("not implemented");
}
