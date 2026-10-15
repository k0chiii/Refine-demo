import { describe, expect, it } from "vite-plus/test";
import {
  alignPages,
  applyManualPairs,
  counterpartPage,
  diffHighlights,
  diffText,
  interpolate,
  alignShift,
  focalPoint,
  lineAnchors,
  mapImagePosition,
  mapPosition,
  relAt,
  textSimilarity,
  type PageFeature,
} from "../comparison/index.ts";

const body = (n: number) =>
  `第${n}章 五月祭の企画紹介。今年は本郷キャンパスで${n * 7}件の企画が参加します。来場者の皆さまは案内所で地図を受け取ってください。ページ番号${n}`;
const pages = (ns: Array<number | string>): PageFeature[] =>
  ns.map((x, i) => ({ page: i + 1, text: typeof x === "number" ? body(x) : x }));
const pairsOf = (r: ReturnType<typeof alignPages>) => r.map((p) => [p.left, p.right]);

describe("ページの自動対応付け", () => {
  it("同じページ数・同じ内容は 1:1（信頼度 high）", () => {
    const r = alignPages(pages([1, 2, 3]), pages([1, 2, 3]));
    expect(pairsOf(r)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(r.every((p) => p.confidence === "high")).toBe(true);
  });
  it("ページ追加: 旧 3 は新 4 に対応し、新 3 は対応なし", () => {
    const r = alignPages(
      pages([1, 2, 3, 4, 5]),
      pages([1, 2, "新しく追加した協賛企業の一覧ページ。株式会社〇〇、△△財団。", 3, 4, 5]),
    );
    expect(pairsOf(r)).toEqual([
      [1, 1],
      [2, 2],
      [null, 3],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(r[2]!.kind).toBe("inserted");
  });
  it("ページ削除: 旧 2 は対応なし", () => {
    const r = alignPages(pages([1, 2, 3]), pages([1, 3]));
    expect(pairsOf(r)).toEqual([
      [1, 1],
      [2, null],
      [3, 2],
    ]);
  });
  it("順序変更: 入れ替わったページを「移動」として対応させる", () => {
    const t = [
      "表紙。第100回五月祭 公式パンフレット。テーマは百花繚乱。",
      "ごあいさつ。委員長から来場者の皆さまへのメッセージを掲載しています。",
      "企画一覧。屋内企画・屋外企画・ステージ企画を分類して紹介します。",
      "会場地図。本郷キャンパスと弥生キャンパスの全体図と案内所の場所。",
    ];
    const r = alignPages(pages([t[0]!, t[1]!, t[2]!, t[3]!]), pages([t[0]!, t[3]!, t[1]!, t[2]!]));
    const moved = r.find((p) => p.kind === "moved");
    expect(moved).toMatchObject({ left: 4, right: 2 });
    expect(counterpartPage(r, "left", 2)).toBe(3);
    expect(counterpartPage(r, "left", 3)).toBe(4);
  });
  it("ページ内の文章が少し変わっても対応する（信頼度は下がる）", () => {
    const changed = body(2).replace(
      "案内所で地図を受け取ってください",
      "正門で配布するパンフレットをご覧ください",
    );
    const r = alignPages(pages([1, 2, 3]), pages([1, changed, 3]));
    expect(counterpartPage(r, "left", 2)).toBe(2);
    expect(r[1]!.score).toBeLessThan(1);
  });
  it("文字情報の無いページは縮小画像で比べ、似ていなければ対応させない", () => {
    const flat = (v: number) => Array.from({ length: 16 }, () => v);
    const left: PageFeature[] = [
      { page: 1, text: "", thumb: flat(0.9) },
      { page: 2, text: "", thumb: flat(0.1) },
    ];
    const right: PageFeature[] = [{ page: 1, text: "", thumb: flat(0.1) }];
    const r = alignPages(left, right);
    expect(counterpartPage(r, "right", 1)).toBe(2);
    expect(counterpartPage(r, "left", 1)).toBeNull();
    // 何の特徴も無いページ同士は対応させない
    expect(pairsOf(alignPages([{ page: 1, text: "" }], [{ page: 1, text: "" }]))).toEqual([
      [1, null],
      [null, 1],
    ]);
  });
  it("大幅なレイアウト変更（全く違う内容）は対応させない", () => {
    const r = alignPages(
      pages([1]),
      pages(["Program and Map. Main stage schedule and food court locations."]),
    );
    expect(counterpartPage(r, "left", 1)).toBeNull();
  });
  it("手動の対応で上書きでき、触れたページの自動の組は外れる", () => {
    const auto = alignPages(pages([1, 2, 3]), pages([1, 2, 3]));
    const fixed = applyManualPairs(auto, [{ left: 2, right: 3 }]);
    expect(counterpartPage(fixed, "left", 2)).toBe(3);
    expect(counterpartPage(fixed, "left", 3)).toBeNull();
    expect(counterpartPage(fixed, "right", 2)).toBeNull();
    expect(fixed.find((p) => p.left === 2)!.kind).toBe("manual");
  });
});

describe("スクロール同期の写像", () => {
  const pairs = alignPages(
    pages([1, 2, 3]),
    pages([1, "追加ページ。協賛のお礼と連絡先の案内をまとめています。", 2, 3]),
  );
  it("左右どちらからでも対応ページへ写し、ページ内の位置は保つ", () => {
    expect(mapPosition({ page: 2, rel: 0.4 }, "left", pairs)).toEqual({ page: 3, rel: 0.4 });
    expect(mapPosition({ page: 3, rel: 0.25 }, "right", pairs)).toEqual({ page: 2, rel: 0.25 });
  });
  it("追加ページ（対応なし）では null を返して同期を止める", () => {
    expect(mapPosition({ page: 2, rel: 0.5 }, "right", pairs)).toBeNull();
  });
  it("同じ行のアンカーの間を補間する（行が下にずれた分だけずらす）", () => {
    const anchors = lineAnchors(
      [
        { text: "見出し", rel: 0.1 },
        { text: "本文の一行目です", rel: 0.3 },
        { text: "末尾の連絡先", rel: 0.9 },
      ],
      [
        { text: "見出し", rel: 0.1 },
        { text: "追加された段落", rel: 0.3 },
        { text: "本文の一行目です", rel: 0.5 },
        { text: "末尾の連絡先", rel: 0.9 },
      ],
    );
    expect(interpolate(anchors, 0.3, "left")).toBeCloseTo(0.5);
    expect(interpolate(anchors, 0.5, "right")).toBeCloseTo(0.3);
    // 0.3→0.5 と 0.9→0.9 の間: 0.5 + (0.3 / 0.6) × 0.4 = 0.7
    expect(interpolate(anchors, 0.6, "left")).toBeCloseTo(0.7);
    const mapped = mapPosition(
      { page: 1, rel: 0.3 },
      "left",
      alignPages(pages([1]), pages([1])),
      () => anchors,
    );
    expect(mapped!.rel).toBeCloseTo(0.5);
  });
});

describe("拡大縮小・同期の視点（縦・横）", () => {
  const pairs = alignPages(
    pages([1, 2, 3]),
    pages([1, "追加ページ。協賛のお礼と連絡先の案内をまとめています。", 2, 3]),
  );
  it("横の割合 relX も対応ページへそのまま写し、0..1 に収める", () => {
    expect(mapPosition({ page: 2, rel: 0.4, relX: 0.7 }, "left", pairs)).toEqual({
      page: 3,
      rel: 0.4,
      relX: 0.7,
    });
    expect(mapPosition({ page: 3, rel: 0.2, relX: 1.3 }, "right", pairs)).toEqual({
      page: 2,
      rel: 0.2,
      relX: 1,
    });
  });
  it("画像どうしは画像内の割合をそのまま写す", () => {
    expect(mapImagePosition({ page: 1, rel: 0.25, relX: -0.1 })).toEqual({
      page: 1,
      rel: 0.25,
      relX: 0,
    });
    expect(mapImagePosition({ page: 1, rel: 0.5 })).toEqual({ page: 1, rel: 0.5 });
  });
  it("拡大の前に控えた割合を描き直した後のページに当てると、焦点の下の箇所が同じ画面位置に残る", () => {
    // 舞台は画面の x=100 から幅 600。焦点は舞台の中央（x=400）
    const point = focalPoint(100, 600, 0.5);
    expect(point).toBe(400);
    // 拡大前: ページは x=250 から幅 400（焦点はページの 37.5%）
    const rel = relAt(250, 400, point);
    expect(rel).toBeCloseTo(0.375);
    // 2 倍にした直後（スクロールはまだ）: ページは x=200 から幅 800。焦点の下は 25% の箇所にずれている
    expect(relAt(200, 800, point)).toBeCloseTo(0.25);
    // scrollLeft を alignShift だけ足すとページは左へ動き、焦点の下が 37.5% に戻る
    const shift = alignShift(200, 800, rel, point);
    expect(shift).toBe(100);
    expect(relAt(200 - shift, 800, point)).toBeCloseTo(rel);
  });
  it("左右の舞台で同じ割合の点に同じ箇所を合わせる（ピンチの焦点が中央でなくても）", () => {
    // 右（操作した側）: 焦点は舞台の左から 20%・ページの 60% の箇所
    const at = 0.2;
    const rightRel = relAt(80, 1200, focalPoint(700, 500, at));
    expect(rightRel).toBeCloseTo(0.6);
    const mapped = mapImagePosition({ page: 1, rel: 0.5, relX: rightRel });
    // 左: 同じ割合の点（舞台は x=100 から幅 500）に、同じ箇所が来るよう動かす
    const leftPoint = focalPoint(100, 500, at);
    const shift = alignShift(-900, 1200, mapped.relX!, leftPoint);
    expect(relAt(-900 - shift, 1200, leftPoint)).toBeCloseTo(rightRel);
  });
});

describe("文章差分（日本語）", () => {
  const oldText =
    "五月祭へようこそ。\n今年のテーマは百花繚乱です。\n会場は本郷キャンパスです。\nお問い合わせは委員会まで。";
  const newText =
    "五月祭へようこそ。\n今年のテーマは「百花繚乱」です。\n入場は無料です。\nお問い合わせは委員会まで。\n会場は本郷キャンパスです。";
  const d = diffText(oldText, newText);
  it("追加・変更・移動を数える", () => {
    expect(d.stats).toEqual({ inserted: 1, deleted: 0, changed: 1, moved: 1 });
  });
  it("変更された段落の中は文字単位（追加された「」だけを強調）", () => {
    const change = d.blocks.find((b) => b.type === "change")!;
    expect(change.added!.map((r) => newText.slice(r.start, r.end))).toEqual(["「", "」"]);
    expect(change.removed).toEqual([]);
  });
  it("削除された文章を旧版側に強調する", () => {
    const d2 = diffText("一行目\n消える行です\n三行目", "一行目\n三行目");
    expect(d2.stats.deleted).toBe(1);
    const hl = diffHighlights(d2, "old");
    expect(hl.map((h) => "一行目\n消える行です\n三行目".slice(h.start, h.end))).toEqual([
      "消える行です",
    ]);
  });
  it("1 文字だけの一致で変更を細切れにしない（努めます → 努めてまいります）", () => {
    const d3 = diffText("お届けできるよう努めます。", "お届けできるよう努めてまいります。");
    const ch = d3.blocks.find((b) => b.type === "change")!;
    const t = "お届けできるよう努めてまいります。";
    // 細切れ（「て」「いりま」）にならず、1 つの連続した変更として示す
    expect(ch.added).toHaveLength(1);
    expect(t.slice(ch.added![0]!.start, ch.added![0]!.end)).toContain("てまいり");
  });
  it("類似度は文字 2-gram（全角英数と半角を同一視）", () => {
    expect(textSimilarity("ＭＦ１００", "MF100")).toBe(1);
    expect(textSimilarity("", "a")).toBe(0);
  });
});
