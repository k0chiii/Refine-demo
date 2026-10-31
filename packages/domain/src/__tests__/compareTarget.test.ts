import { describe, expect, it } from "vite-plus/test";
import type { WorkPermissionGrant } from "../acl/Permission.ts";
import {
  canEditAlignment,
  compareTargetLabel,
  comparisonScope,
  pickCompareArtifact,
} from "../comparison/index.ts";
import type { Artifact } from "../revision/Artifact.ts";
import { makeWork, T0 } from "./fixtures.ts";

const art = (over: Partial<Artifact>): Artifact => ({
  id: "a",
  revisionId: "rev",
  type: "pdf",
  role: "source",
  fileName: "a.pdf",
  mimeType: "application/pdf",
  status: "verified",
  ...over,
});

describe("別の制作物との比較（利用者指示 2026-10-17）", () => {
  it("同じ制作物か別の制作物か", () => {
    expect(comparisonScope("w1", "w1")).toBe("same_work");
    expect(comparisonScope("w1", "w2")).toBe("cross_work");
  });

  it("左の見出し: 同じ制作物は版の名前だけ、別の制作物は「題名・版」", () => {
    const t = { workId: "w2", workTitle: "EVE 企画ポスター", revisionLabel: "第1版" };
    expect(compareTargetLabel(t, "w2")).toBe("第1版");
    expect(compareTargetLabel(t, "w1")).toBe("EVE 企画ポスター・第1版");
  });

  it("並べる添付: 同じ制作物はファイル名を先に、別の制作物は種類を先に選ぶ。無ければ紙面に出す添付", () => {
    const cands = [
      art({ id: "ai", type: "other", fileName: "poster.ai" }),
      art({ id: "png", type: "image", fileName: "poster.png", mimeType: "image/png" }),
      art({ id: "pdf", type: "pdf", fileName: "poster.pdf" }),
      art({ id: "ext", type: "external_link", role: "external", fileName: "figma" }),
    ];
    // 同じ制作物: 名前が同じ添付（種類が違っても）を優先
    expect(
      pickCompareArtifact(cands, { type: "pdf", fileName: "poster.png" }, "same_work")?.id,
    ).toBe("png");
    // 別の制作物: 名前は違うのが普通なので、同じ種類を先に
    expect(
      pickCompareArtifact(cands, { type: "pdf", fileName: "flyer.pdf" }, "cross_work")?.id,
    ).toBe("pdf");
    expect(
      pickCompareArtifact(cands, { type: "image", fileName: "flyer.jpg" }, "cross_work")?.id,
    ).toBe("png");
    // 同じ種類が無ければ、紙面に出す順（PDF → 画像 → 文章 → 動画）
    expect(
      pickCompareArtifact(cands, { type: "document", fileName: "body.txt" }, "cross_work")?.id,
    ).toBe("pdf");
    // 外部リンクは並べない
    expect(pickCompareArtifact([cands[3]!], { type: "pdf", fileName: "x" }, "cross_work")).toBe(
      null,
    );
    expect(pickCompareArtifact(cands, null, "cross_work")?.id).toBe("pdf");
  });

  it("手動のページ対応を直せるのは、表示中の制作物で版を提出できる人かコメントできる人", () => {
    const work = makeWork();
    const grant = (userId: string, permission: WorkPermissionGrant["permission"]) =>
      ({
        workId: work.id,
        principalType: "user",
        principalId: userId,
        permission,
        grantedBy: "admin",
        grantedAt: T0,
      }) as WorkPermissionGrant;
    const principal = (userId: string) => ({
      userId,
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: [],
    });
    expect(canEditAlignment({ work, grants: [], principal: principal("creator") })).toBe(true);
    expect(
      canEditAlignment({ work, grants: [grant("rev", "review")], principal: principal("rev") }),
    ).toBe(true);
    expect(canEditAlignment({ work, grants: [], principal: principal("nobody") })).toBe(false);
  });
});
