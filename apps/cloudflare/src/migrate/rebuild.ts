import type { Work } from "@mf100/domain";
import {
  adjustUnreadCounter,
  LAZY_COUNT_LIMIT,
  syncRevisionThreadStats,
  syncWorkRoles,
} from "../sqlite/derived.ts";
import { parseDocs } from "../sqlite/docs.ts";
import type { Sql } from "../sqlite/sql.ts";

/**
 * 取り込みのあと、元の行（works・revisions・threads・approvals・notifications）から派生表を作り直す。
 * derived.ts は 1 件ずつ同期する関数しか持たないので、全件の入口はここ。何度呼んでも同じ（元の行から導くだけ）。
 *
 * 順序:
 * 1. 版のスレッド件数（revisions.unresolvedCount / openBotCount / threadCount。要約も作る）
 * 2. 制作物ごとに 職責 → 検索 → 要約（syncWorkRoles が 3 つとも呼ぶ。Convex の syncWorkRoles と同じ並び）
 * 3. 未読の数
 *
 * ponytail: 1 回の呼び出しで全件を回す。要約は版ごとに作ってから制作物ごとにもう一度見る（変わらなければ書かない）。
 * 制作物が数万を超えて 1 リクエストに収まらなくなったら、works の rowid を範囲で区切って分ける。
 */
export function rebuildDerived(sql: Sql): void {
  // 古い行が残らないよう、行ごとに作り直す表は空にしてから入れる（workSearch は syncWorkSearch が rowid で突き合わせるので触らない）
  sql.exec("DELETE FROM workRoles");
  sql.exec("DELETE FROM workSummaries");
  sql.exec("DELETE FROM notificationCounters");

  for (const r of sql.exec("SELECT id FROM revisions ORDER BY rowid"))
    syncRevisionThreadStats(sql, r.id as string);

  for (const work of parseDocs<Work>(sql.exec("SELECT doc FROM works ORDER BY rowid")))
    syncWorkRoles(sql, work);

  // 行が無いと数える側が未読を LAZY_COUNT_LIMIT 件まで数える（Convex と同じ）ので、ここも同じ上限で行を作る。
  // 行を消してあるので、adjustUnreadCounter は「行が無い → 今の未読を数えて作る」道を通る
  const uncountable = new Set<string>();
  for (const r of sql.exec(
    "SELECT recipientId FROM notifications WHERE readAt IS NULL AND recipientId IS NOT NULL GROUP BY recipientId HAVING count(*) <= ?",
    LAZY_COUNT_LIMIT,
  ))
    adjustUnreadCounter(sql, r.recipientId as string, 1, uncountable);
}
