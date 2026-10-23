import { fixture, PAMPHLET, type App } from "./app";

/**
 * spec の前提をつくる手順（撮影も検証もしない。速く・同じ状態に着くことだけが仕事）。
 * spec はほかの spec の結果に頼らず、ここを組み合わせて自分の前提を用意する。
 * 終わったときのサインイン中の人は各関数の説明のとおり（次の手順の頭で signInAs し直してよい）
 */

/** 制作者が制作物に最初の版を出す。終わると制作者のまま、第1版（/v/1）を開いている */
export async function submitFirstRevision(
  app: App,
  title = PAMPHLET,
  files = [fixture("sample.pdf")],
) {
  await app.signInAs("mock-nogiku-creator");
  const workPath = await app.openWork(title);
  await app.uploadRevision("最初の版を提出", files, "初稿。", () => app.tickSelfChecks());
  const revisionPath = await app.confirmRevision(1);
  return { workPath, revisionPath };
}

/** 制作者が次の版を出す（制作物の版を開いている前提）。終わると新しい版を開いている */
export async function submitNextRevision(app: App, n: number, summary = `第${n}版。`) {
  await app.drawer("版");
  await app.uploadRevision("新しい版を提出", [fixture("sample.pdf")], summary);
  return app.confirmRevision(n);
}

/** 主管が校正者を 1 人割り当てる。終わると主管のまま、制作物を開いている */
export async function assignReviewer(app: App, workPath: string) {
  const reviewer = await app.user("mock-nogiku-reviewer");
  await app.signInAs("mock-nogiku-manager");
  await app.go(workPath);
  await app.pdfReady();
  await app.drawer("情報");
  await app.btn("校正者を割り当てる").click();
  await app.page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await app.pickUser(app.dialog(), reviewer.name);
  await app.dialog().locator("m3e-button", { hasText: "保存" }).click();
  await app.page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  return reviewer;
}

/** 校正者が版に位置なしのコメントを付ける。終わると校正者のまま、その版を開いている */
export async function reviewerComments(app: App, revisionPath: string, body: string) {
  await app.signInAs("mock-nogiku-reviewer");
  await app.go(revisionPath);
  await app.pdfReady();
  await app.drawer("コメント");
  await app.freeComment(body);
}
