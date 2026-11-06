import { describe, expect, it } from "vite-plus/test";
import { app, fakeDb, post, signIn } from "./testing/http.ts";

// documents:*（文章の下書き）を HTTP から 1 周させる。期待は apps/convex/convex/documents.test.ts と collaboration.test.ts から写した

/** 戻りの形を見るテストなので、型は付けずに値だけ引く */
// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

const doc = (t: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });

function world() {
  const db = fakeDb(undefined, { MF100_SYSTEM_ADMIN_SUBJECTS: "u_admin" });
  const a = app(db);
  const call = async (name: string, args: unknown, subject = "u_creator") => {
    const res = await post(a, name, args, subject);
    const body = (await res.json()) as { value?: unknown };
    expect(res.status, `${name}: ${JSON.stringify(body)}`).toBe(200);
    return body.value as Json;
  };
  const fail = async (name: string, args: unknown, subject = "u_creator") => {
    const res = await post(a, name, args, subject);
    return { status: res.status, ...((await res.json()) as { code: string }) };
  };
  const create = async (title: string, mediaType = "document") =>
    (await call(
      "works:create",
      {
        title,
        purpose: "来場者向け",
        category: "文章",
        mediaType,
        year: 100,
        creatorIds: [await signIn(a, "u_creator")],
        approverId: await signIn(a, "u_approver"),
      },
      "u_manager",
    )) as string;
  return { db, a, call, fail, create };
}

describe("documents:get / save", () => {
  it("制作者が保存し、校正者は読めるが書けない。古い版番号と壊れた本文は拒否", async () => {
    const w = world();
    const workId = await w.create("あいさつ文");
    const reviewer = await signIn(w.a, "u_reviewer");
    await w.call("acl:grant", { workId, userIds: [reviewer], permission: "review" }, "u_admin");

    expect(await w.call("documents:get", { workId })).toEqual({
      draft: null,
      canEdit: true,
      collaborative: false,
    });
    const saved = await w.call("documents:save", {
      workId,
      title: "五月祭のごあいさつ",
      content: doc("皆さま"),
      text: "皆さま",
      baseVersion: 0,
    });
    expect(saved.version).toBe(1);

    const seen = await w.call("documents:get", { workId }, "u_reviewer");
    expect(seen.canEdit).toBe(false);
    expect(seen.draft).toMatchObject({ title: "五月祭のごあいさつ", text: "皆さま", version: 1 });
    expect(seen.draft.updatedBy.id).toBe(await signIn(w.a, "u_creator"));
    expect(
      await w.fail(
        "documents:save",
        { workId, title: "x", content: doc("x"), text: "x", baseVersion: 1 },
        "u_reviewer",
      ),
    ).toMatchObject({ status: 403, code: "forbidden" });
    // 閲覧は誰でもできるが、書けない
    expect((await w.call("documents:get", { workId }, "u_stranger")).canEdit).toBe(false);
    expect(
      await w.fail("documents:save", {
        workId,
        title: "t",
        content: doc("y"),
        text: "y",
        baseVersion: 0,
      }),
    ).toMatchObject({ status: 409, code: "version_conflict" });
    expect(
      await w.fail("documents:save", {
        workId,
        title: "t",
        content: "not json",
        text: "y",
        baseVersion: 1,
      }),
    ).toMatchObject({ code: "document_invalid" });
  });

  it("制作物の媒体と形式が違う本文は保存できない（document_format_mismatch）", async () => {
    const w = world();
    const workId = await w.create("公式 Instagram", "sns");
    expect(
      await w.fail("documents:save", {
        workId,
        title: "投稿",
        content: doc("本文"),
        text: "本文",
        baseVersion: 0,
      }),
    ).toMatchObject({ status: 400, code: "document_format_mismatch" });
  });

  it("共同編集に切り替えた下書きは、documents:save で書けない（collaborative_draft_requires_sync）", async () => {
    const w = world();
    const workId = await w.create("原稿");
    await w.call("collaboration:enable", { workId });
    expect(await w.call("documents:get", { workId })).toMatchObject({ collaborative: true });
    expect(
      await w.fail("documents:save", {
        workId,
        title: "t",
        content: doc("x"),
        text: "x",
        baseVersion: 0,
      }),
    ).toMatchObject({ status: 400, code: "collaborative_draft_requires_sync" });
  });
});

describe("documents:writable（エディタの入口）", () => {
  it("書ける担当の制作物だけが、下書きの要約つきで出る。校正だけの人・関係ない人には出ない", async () => {
    const w = world();
    const a = await w.create("あいさつ文");
    const b = await w.create("会場案内");
    const reviewer = await signIn(w.a, "u_reviewer");
    await w.call("acl:grant", { workId: a, userIds: [reviewer], permission: "review" }, "u_admin");
    await w.call("documents:save", {
      workId: b,
      title: "会場案内の文案",
      content: doc("本郷キャンパス"),
      text: "本郷キャンパス",
      baseVersion: 0,
    });

    const mine = await w.call("documents:writable", {});
    expect(mine.map((x: { title: string }) => x.title)).toEqual(["会場案内", "あいさつ文"]);
    expect(mine[0].draft).toMatchObject({ title: "会場案内の文案", chars: 7 });
    expect(mine[0].draft.updatedBy.id).toBe(await signIn(w.a, "u_creator"));
    // 本文そのものは返さない
    expect(mine[0].draft).not.toHaveProperty("content");
    expect(await w.call("documents:writable", {}, "u_reviewer")).toEqual([]);
    expect(await w.call("documents:writable", {}, "u_stranger")).toEqual([]);
  });
});
