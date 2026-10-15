import type { Principal } from "@mf100/domain";

/** テスト・サンプルデータ生成で共用する主体（インメモリの名簿には最初から委員として載っている） */
export const principals = {
  manager: { userId: "u_manager", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  creator: { userId: "u_creator", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  approver: { userId: "u_approver", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  reviewer: { userId: "u_reviewer", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  stranger: { userId: "u_stranger", isSystemAdmin: false, groupIds: [], orgPermissions: ["*"] },
  sysadmin: { userId: "u_sysadmin", isSystemAdmin: true, groupIds: [], orgPermissions: ["*"] },
} satisfies Record<string, Principal>;
