import { describe, expect, it } from "vite-plus/test";
import {
  type CommentEvent,
  editThreadBody,
  type Resolution,
  resolutions,
} from "../comment/CommentThread.ts";
import { presentThread, projectThreadEvents } from "../comment/deletion.ts";
import { planReplyEdit } from "../comment/replyEdit.ts";
import { type WorkLifecycle, workLifecycles } from "../work/Work.ts";
import { makeThread } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const thread = makeThread();

const reply = (
  id: string,
  actorId: string,
  payload: Record<string, unknown> = {},
): CommentEvent => ({
  id,
  threadId: "t1",
  eventType: "replied",
  actorId,
  payload: { body: "返信", ...payload },
  createdAt: 10,
});
const event = (
  id: string,
  eventType: CommentEvent["eventType"],
  payload?: Record<string, unknown>,
): CommentEvent => ({
  id,
  threadId: "t1",
  eventType,
  actorId: "reviewer",
  ...(payload ? { payload } : {}),
  createdAt: 20,
});

describe("返信の訂正（返信した本人・校了前だけ）", () => {
  const events = [reply("r1", "creator"), reply("r2", "reviewer", { bodyFormat: "markdown" })];

  it("本人は校了前に訂正できる。今の本文と書式が置き換わり、訂正前の本文を記録に残す", () => {
    const plain = planReplyEdit(
      thread,
      "r1",
      "creator",
      "**直した**",
      "markdown",
      "active",
      events,
    );
    expect(plain).toStrictEqual({
      changed: true,
      replyEventId: "r1",
      next: { body: "**直した**", bodyFormat: "markdown" },
      previous: { replyEventId: "r1", previousBody: "返信", bodyFormat: "markdown" },
    });
    const markdown = planReplyEdit(thread, "r2", "reviewer", "直した", undefined, "active", events);
    expect(markdown).toStrictEqual({
      changed: true,
      replyEventId: "r2",
      next: { body: "直した" },
      previous: { replyEventId: "r2", previousBody: "返信", previousBodyFormat: "markdown" },
    });
  });

  it("他の人は、スレッドの投稿者でもシステム管理者でも訂正できない。校了後は本人も訂正できない", () => {
    for (const actor of ["reviewer", "admin", "approver"])
      expect(() =>
        planReplyEdit(thread, "r1", actor, "直した", "markdown", "active", events),
      ).toThrowError(code("comment_edit_not_author"));
    expect(() =>
      planReplyEdit(thread, "r1", "creator", "直した", "markdown", "finalized", events),
    ).toThrowError(code("work_already_finalized"));
  });

  it("存在しない・返信でない・削除した返信は見つからない", () => {
    const withOthers = [
      ...events,
      event("c1", "created"),
      event("d1", "reply_deleted", { replyEventId: "r1" }),
    ];
    for (const id of ["nope", "c1", "r1"])
      expect(() =>
        planReplyEdit(thread, id, "creator", "直した", "markdown", "active", withOthers),
      ).toThrowError(code("comment_reply_not_found"));
  });

  it("本文を空にできるのは添付のある返信だけ（返信の投稿と同じ）", () => {
    expect(() =>
      planReplyEdit(thread, "r1", "creator", "  ", "markdown", "active", events),
    ).toThrowError(code("forbidden"));
    const withFile = [reply("r3", "creator", { fileIds: ["f1"] })];
    expect(
      planReplyEdit(thread, "r3", "creator", "", "markdown", "active", withFile),
    ).toMatchObject({ changed: true, next: { body: "" } });
  });

  it("本文も書式も同じなら何も変えない。書式だけ違えば訂正になる", () => {
    expect(planReplyEdit(thread, "r2", "reviewer", "返信", "markdown", "active", events)).toEqual({
      changed: false,
    });
    expect(planReplyEdit(thread, "r1", "creator", "返信", undefined, "active", events)).toEqual({
      changed: false,
    });
    expect(
      planReplyEdit(thread, "r1", "creator", "返信", "markdown", "active", events).changed,
    ).toBe(true);
  });
});

describe("流れの見せ方（訂正は印だけ。訂正の記録は並べない）", () => {
  const events: CommentEvent[] = [
    event("c1", "created"),
    event("e1", "edited", { previousBody: "元の本文" }),
    reply("r1", "creator"),
    reply("r2", "reviewer"),
    event("x1", "reply_edited", { replyEventId: "r1", previousBody: "元の返信" }),
    event("dec", "decided"),
  ];

  it("訂正の記録（edited / reply_edited）を流れから外し、訂正した返信に印を付ける", () => {
    const view = projectThreadEvents(events, "creator", "active");
    expect(view.map((e) => e.id)).toEqual(["c1", "r1", "r2", "dec"]);
    expect(view.find((e) => e.id === "r1")!.edited).toBe(true);
    expect(view.find((e) => e.id === "r2")!.edited).toBe(false);
  });

  it("返信の can.edit は本人の校了前だけ。管理者の can.delete はこれまでどおり", () => {
    const can = (viewer: string, lifecycle: WorkLifecycle, admin = false) =>
      Object.fromEntries(
        projectThreadEvents(events, viewer, lifecycle, { isSystemAdmin: admin })
          .filter((e) => e.eventType === "replied")
          .map((e) => [e.id, e.can]),
      );
    expect(can("creator", "active")).toEqual({
      r1: { delete: true, edit: true },
      r2: { delete: false, edit: false },
    });
    expect(can("creator", "finalized")).toEqual({
      r1: { delete: false, edit: false },
      r2: { delete: false, edit: false },
    });
    expect(can("admin", "finalized", true)).toEqual({
      r1: { delete: true, edit: false },
      r2: { delete: true, edit: false },
    });
  });
});

describe("元のコメントの can.edit は、訂正が受け付けられるときだけ真", () => {
  const succeeds = (resolution: Resolution, viewer: string) => {
    try {
      editThreadBody(makeThread({ resolution }), viewer, "直した", "markdown");
      return true;
    } catch {
      return false;
    }
  };

  it("投稿者 × 採否 × 制作物の状態の全てで、訂正の可否と一致する", () => {
    for (const viewer of ["reviewer", "creator"])
      for (const resolution of resolutions)
        for (const lifecycle of workLifecycles)
          expect(
            presentThread(makeThread({ resolution }), viewer, lifecycle).can.edit,
            `${viewer} ${resolution} ${lifecycle}`,
          ).toBe(lifecycle !== "finalized" && succeeds(resolution, viewer));
  });

  it("投稿者が未判断の間だけ。判断の後・校了後・他の人・管理者は訂正できない", () => {
    const admin = { isSystemAdmin: true };
    const can = (resolution: Resolution, viewer: string, lifecycle: WorkLifecycle) =>
      presentThread(makeThread({ resolution }), viewer, lifecycle).can.edit;
    expect(presentThread(makeThread(), "reviewer", "active").can).toEqual({
      delete: true,
      edit: true,
    });
    expect(can("acknowledged", "reviewer", "active")).toBe(true);
    expect(can("accepted", "reviewer", "active")).toBe(false);
    expect(can("open", "reviewer", "finalized")).toBe(false);
    expect(can("open", "creator", "active")).toBe(false);
    expect(presentThread(makeThread(), "admin", "active", admin).can).toEqual({
      delete: true,
      edit: false,
    });
  });
});
