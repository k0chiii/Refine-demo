import { describe, expect, it } from "vite-plus/test";
import { SOCIAL_PROFILE_MAX } from "@mf100/domain";
import { deleteSocialProfile, listSocialProfiles, saveSocialProfile } from "../usecases/social.ts";
import { updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const ig = {
  platform: "instagram" as const,
  displayName: "第100回五月祭",
  username: "mayfes_official",
  verified: true,
};

describe("SNS のアカウント（本体の設定）", () => {
  it("システム管理者だけが登録・変更・削除でき、誰でも一覧を見られる", async () => {
    const ctx = createInMemoryContext();
    await expect(saveSocialProfile(ctx, principals.manager, ig)).rejects.toThrow(code("forbidden"));
    const p = await saveSocialProfile(ctx, principals.sysadmin, ig);
    expect((await listSocialProfiles(ctx, principals.creator)).map((x) => x.username)).toEqual([
      "mayfes_official",
    ]);
    const renamed = await saveSocialProfile(ctx, principals.sysadmin, {
      ...ig,
      id: p.id,
      displayName: "五月祭",
    });
    expect(renamed.displayName).toBe("五月祭");
    await deleteSocialProfile(ctx, principals.sysadmin, p.id);
    expect(await listSocialProfiles(ctx, principals.creator)).toEqual([]);
  });

  it(`登録は ${SOCIAL_PROFILE_MAX} 件まで`, async () => {
    const ctx = createInMemoryContext();
    for (let i = 0; i < SOCIAL_PROFILE_MAX; i++)
      await saveSocialProfile(ctx, principals.sysadmin, { ...ig, username: `acct_${i}` });
    await expect(
      saveSocialProfile(ctx, principals.sysadmin, { ...ig, username: "one_more" }),
    ).rejects.toThrow(code("social_profile_limit"));
  });

  it("制作物に割り当て・外せる。割り当て中のアカウントは消せない。無いアカウントは割り当てられない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType: "sns" });
    const p = await saveSocialProfile(ctx, principals.sysadmin, ig);
    const assigned = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { socialProfileId: p.id },
    });
    expect(assigned.socialProfileId).toBe(p.id);
    await expect(deleteSocialProfile(ctx, principals.sysadmin, p.id)).rejects.toThrow(
      code("social_profile_in_use"),
    );
    await expect(
      updateWork(ctx, principals.manager, { workId: work.id, patch: { socialProfileId: "nope" } }),
    ).rejects.toThrow(code("social_profile_invalid"));
    const cleared = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { socialProfileId: null },
    });
    expect(cleared.socialProfileId).toBeUndefined();
    await deleteSocialProfile(ctx, principals.sysadmin, p.id);
  });
});
