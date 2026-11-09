import { personDisplayName } from "@mf100/domain";
import { base64urlEncode } from "@mf100/platform";
import type { Sql } from "../sqlite/sql.ts";

/** Nogiku（またはモック）のプロフィール。providers/nogiku.ts の NogikuOAuthProfile と同じ項目 */
export interface AuthProfile {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  hurigana?: string;
  generation?: number;
  /** undefined は「取得しなかった・失敗した」。保存済みの権限を消さない */
  orgPermissions?: string[];
}

export interface UpsertOptions {
  source: "nogiku" | "nogiku_mock";
  /** MF100_SYSTEM_ADMIN_SUBJECTS に入っているか。昇格だけで、降格は管理画面から */
  admin: boolean;
}

/** セッションと、そこで使える refresh。access token を作るのに userId が要るので一緒に返す */
export interface SessionGrant {
  userId: string;
  sessionId: string;
  refreshToken: string;
}

export interface AuthState {
  state: string;
  verifier: string;
  nonce: string;
  /** 検証済みの絶対 URL */
  redirectTo: string;
  /** Web の verifier の SHA-256（base64url）。callback の一時コードに引き継ぐ */
  challenge: string;
}

/** 一時コードの中身。verifier との突き合わせは呼ぶ側（auth/app.ts）がやる */
export interface ConsumedCode {
  sessionId: string;
  challenge: string;
}

/**
 * 認証の保存。Durable Object の中では SQL に直に触り、Worker からは RPC 越しに呼ぶので、全部 Promise にしてある。
 * 「1 回しか使えない」ものは SELECT してから DELETE ではなく、DELETE ... RETURNING の 1 文で取る（同時に来ても 1 人だけが勝つ）
 */
export interface AuthStore {
  upsertUserFromProfile(profile: AuthProfile, options: UpsertOptions): Promise<string>;
  createSession(userId: string): Promise<SessionGrant>;
  /** 一時コードで入った直後に、そのセッションの refresh を（作り直して）渡す。createSession の値は 1 度も外に出ていない */
  reissueRefresh(sessionId: string): Promise<SessionGrant | null>;
  /** refresh を新しいものに替える。古いものは使えなくなる。知らない・期限切れは null */
  rotateSession(refreshToken: string): Promise<SessionGrant | null>;
  revokeSession(refreshToken: string): Promise<void>;
  /** 60 秒・1 回きりの一時コード（トークンを URL に載せないため）。challenge でサインインしたブラウザに結び付ける */
  issueCode(sessionId: string, challenge: string): Promise<string>;
  /** 取った時点で消す（verifier が合わなくても 2 度目は無い） */
  consumeCode(code: string): Promise<ConsumedCode | null>;
  putState(state: AuthState): Promise<void>;
  takeState(state: string): Promise<AuthState | null>;
  /** 期限切れの掃除 */
  sweep(): Promise<void>;
}

const CODE_TTL_MS = 60_000;
const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * 認証の表を作る。**`migrate(sql)`（users を作る側）の後に**呼ぶ: users を先にここで作ると、あとの CREATE IF NOT EXISTS が
 * 生成列つきの定義を作れなくなる。
 * users.subject は列ではなく式の unique index にした。ALTER TABLE ADD COLUMN には IF NOT EXISTS が無く、
 * 別の人が同じ生成列を足していても衝突しないようにするため（式が同じなら検索もこの index に当たる）。
 */
export function migrateAuth(sql: Sql): void {
  sql.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_subject ON users (json_extract(doc, '$.subject'))",
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS authSessions (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, refreshHash TEXT NOT NULL,
      expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL)`,
  );
  sql.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_authSessions_refreshHash ON authSessions (refreshHash)",
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS authCodes (
      code TEXT PRIMARY KEY, sessionId TEXT NOT NULL, challenge TEXT NOT NULL, expiresAt INTEGER NOT NULL)`,
  );
  // verifier（PKCE）と nonce は callback まで持ち回る
  sql.exec(
    `CREATE TABLE IF NOT EXISTS authStates (
      state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL,
      redirectTo TEXT NOT NULL, challenge TEXT NOT NULL, expiresAt INTEGER NOT NULL)`,
  );
}

interface UserDoc {
  subject: string;
  name?: string;
  nameKanji?: string;
  hurigana?: string;
  email?: string;
  picture?: string;
  generation?: number;
  orgPermissions?: string[];
  isSystemAdmin?: boolean;
  source?: string;
  lastLoginAt?: number;
}

const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** refresh は 256 bit の乱数なので、保存は塩なしの SHA-256 で足りる（DB が漏れても元に戻せない） */
export async function sha256Base64url(text: string): Promise<string> {
  return base64urlEncode(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
  );
}

export function createAuthStore(sql: Sql, now: () => number = Date.now): AuthStore {
  const newRefresh = async () => {
    const refreshToken = randomToken();
    return { refreshToken, refreshHash: await sha256Base64url(refreshToken) };
  };

  return {
    async upsertUserFromProfile(profile, options) {
      const [row] = sql.exec(
        "SELECT id, doc FROM users WHERE json_extract(doc, '$.subject') = ?",
        profile.sub,
      );
      const existing = row ? (JSON.parse(row.doc as string) as Partial<UserDoc>) : {};
      // 取れた項目だけを重ねる（undefined は「分からない」であって「空にする」ではない）
      const merged: UserDoc = {
        ...existing,
        subject: profile.sub,
        source: options.source,
        lastLoginAt: now(),
        isSystemAdmin: existing.isSystemAdmin === true || options.admin,
        ...(profile.name !== undefined ? { nameKanji: profile.name } : {}),
        ...(profile.email !== undefined ? { email: profile.email } : {}),
        ...(profile.picture !== undefined ? { picture: profile.picture } : {}),
        ...(profile.hurigana !== undefined ? { hurigana: profile.hurigana } : {}),
        ...(profile.generation !== undefined ? { generation: profile.generation } : {}),
        ...(Array.isArray(profile.orgPermissions)
          ? { orgPermissions: profile.orgPermissions }
          : {}),
      };
      // users.name は画面に出す名前（ふりがな、無ければ漢字）。漢字は nameKanji に残す（検索用）
      const display = personDisplayName({ name: merged.nameKanji, hurigana: merged.hurigana });
      if (display !== "") merged.name = display;

      if (row) {
        sql.exec("UPDATE users SET doc = ? WHERE id = ?", JSON.stringify(merged), row.id as string);
        return row.id as string;
      }
      const id = crypto.randomUUID();
      sql.exec("INSERT INTO users (id, doc) VALUES (?, ?)", id, JSON.stringify(merged));
      return id;
    },

    async createSession(userId) {
      const sessionId = crypto.randomUUID();
      const { refreshToken, refreshHash } = await newRefresh();
      const at = now();
      sql.exec(
        "INSERT INTO authSessions (id, userId, refreshHash, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)",
        sessionId,
        userId,
        refreshHash,
        at + SESSION_TTL_MS,
        at,
      );
      return { userId, sessionId, refreshToken };
    },

    async reissueRefresh(sessionId) {
      const { refreshToken, refreshHash } = await newRefresh();
      const at = now();
      const [row] = sql.exec(
        "UPDATE authSessions SET refreshHash = ?, expiresAt = ? WHERE id = ? AND expiresAt > ? RETURNING userId",
        refreshHash,
        at + SESSION_TTL_MS,
        sessionId,
        at,
      );
      return row ? { userId: row.userId as string, sessionId, refreshToken } : null;
    },

    async rotateSession(oldToken) {
      const { refreshToken, refreshHash } = await newRefresh();
      const at = now();
      // 古い hash に当たる行だけを 1 文で書き換える。同じ refresh を 2 回送っても勝つのは 1 回だけ
      const [row] = sql.exec(
        "UPDATE authSessions SET refreshHash = ?, expiresAt = ? WHERE refreshHash = ? AND expiresAt > ? RETURNING id, userId",
        refreshHash,
        at + SESSION_TTL_MS,
        await sha256Base64url(oldToken),
        at,
      );
      // ponytail: 使用済みの refresh が再び来ても、セッション全体は失効させない（盗用の検知は未対応）
      return row
        ? { userId: row.userId as string, sessionId: row.id as string, refreshToken }
        : null;
    },

    async revokeSession(refreshToken) {
      sql.exec(
        "DELETE FROM authSessions WHERE refreshHash = ?",
        await sha256Base64url(refreshToken),
      );
    },

    async issueCode(sessionId, challenge) {
      const code = randomToken();
      sql.exec(
        "INSERT INTO authCodes (code, sessionId, challenge, expiresAt) VALUES (?, ?, ?, ?)",
        code,
        sessionId,
        challenge,
        now() + CODE_TTL_MS,
      );
      return code;
    },

    async consumeCode(code) {
      const [row] = sql.exec(
        "DELETE FROM authCodes WHERE code = ? RETURNING sessionId, challenge, expiresAt",
        code,
      );
      // 期限切れも消してから断る（残しておく理由がない）
      return row && (row.expiresAt as number) > now()
        ? { sessionId: row.sessionId as string, challenge: row.challenge as string }
        : null;
    },

    async putState(s) {
      sql.exec(
        "INSERT INTO authStates (state, verifier, nonce, redirectTo, challenge, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
        s.state,
        s.verifier,
        s.nonce,
        s.redirectTo,
        s.challenge,
        now() + STATE_TTL_MS,
      );
    },

    async takeState(state) {
      const [row] = sql.exec(
        "DELETE FROM authStates WHERE state = ? RETURNING verifier, nonce, redirectTo, challenge, expiresAt",
        state,
      );
      if (!row || (row.expiresAt as number) <= now()) return null;
      return {
        state,
        verifier: row.verifier as string,
        nonce: row.nonce as string,
        redirectTo: row.redirectTo as string,
        challenge: row.challenge as string,
      };
    },

    async sweep() {
      const at = now();
      sql.exec("DELETE FROM authCodes WHERE expiresAt <= ?", at);
      sql.exec("DELETE FROM authStates WHERE expiresAt <= ?", at);
      sql.exec("DELETE FROM authSessions WHERE expiresAt <= ?", at);
    },
  };
}
