/**
 * 制作物の閲覧範囲のポリシー（D3 の細則。利用者決定 2026-10-17「閲覧は基本全員できて良い」）。
 * 制度の判断はコードで確定せず、ApprovalPolicy（D2）と同じく値として外出しする。戻すときはこの値だけを変える。
 *
 * - `all_members`: 機密区分が通常（normal）の制作物は、サインインした委員なら誰でも見られる（現在の既定）
 * - `involved_only`: 通常の制作物も、職責・閲覧 ACL・関係者・担当の所属がある人だけ（2026-10-17 より前の扱い）
 *
 * 機密区分が非公開・取扱注意（restricted）の制作物は、この値に関わらず、職責・閲覧 ACL・関係者・
 * 主管担当／制作担当／関係担当に所属する人だけが見られる（{@link canViewWork}）。
 * 閲覧だけの規則で、編集・コメント・採否・割当・校了・ACL の管理の規則は変えない。
 */
export type NormalWorkViewScope = "all_members" | "involved_only";

export interface WorkViewPolicy {
  /** 通常（normal）の制作物を見られる範囲 */
  normalWorks: NormalWorkViewScope;
}

export const defaultWorkViewPolicy: WorkViewPolicy = {
  normalWorks: "all_members",
};
