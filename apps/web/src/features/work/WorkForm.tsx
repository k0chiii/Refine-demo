import { api } from "@mf100/convex/api";
import {
  defaultMediaTypeFor,
  genreOfSubGenre,
  socialPlatformLabels,
  subGenresOf,
  WORK_CATEGORY_MAX,
  WORK_SIZE_MAX,
  WORK_TITLE_MAX,
  workGenreLabels,
  workGenres,
  workSubGenreLabel,
  workSubGenres,
  type WorkGenre,
  type WorkSubGenre,
} from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { mediaLabel } from "@/lib/labels";
import { DateField } from "@/ui/DateField";
import {
  Checkbox,
  Field,
  Select,
  TextArea,
  TextInput,
  useFieldId,
  useFieldLabelId,
} from "@/ui/Field";
import { M3eExpansionPanel, M3eOptGroup, M3eOption, M3eSelect } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";
import { CategoryPicker } from "@/features/notation/CategoryPicker";
import { TagPicker } from "./TagPicker";
import { TeamSelect } from "./TeamSelect";

type Work = FunctionReturnType<typeof api.works.get>["work"];

/**
 * 制作物の登録・編集で共通の入力（Notion の制作物 DB に揃えた項目。利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）。
 * 画面の値は文字列で持ち（数は入力中の空を許す）、送るときに {@link workFormToFields} で数・null に直す。
 */
export interface WorkFormState {
  title: string;
  purpose: string;
  genre: WorkGenre | "";
  subGenre: WorkSubGenre | "";
  /** 区分。小ジャンルを選ぶとその名前が入る（詳細設定で上書きできる） */
  category: string;
  mediaType: string;
  legacyId: string;
  confidentiality: string;
  deadlineAt: number | null;
  publishAt: number | null;
  requiresPrinterSubmission: boolean;
  printQuantity: string;
  sizeOrLength: string;
  productionDays: string;
  tags: string[];
  driveFolderUrl: string;
  slackChannelId: string;
  creatorIds: string[];
  approverIds: string[];
  managerIds: string[];
  stakeholderIds: string[];
  ownerTeam: string[];
  productionTeamIds: string[];
  relatedTeamIds: string[];
  notationCategories: string[];
  socialProfileId: string;
}

export function emptyWorkForm(): WorkFormState {
  return {
    title: "",
    purpose: "",
    genre: "",
    subGenre: "",
    category: "",
    mediaType: "pdf",
    legacyId: "",
    confidentiality: "normal",
    deadlineAt: null,
    publishAt: null,
    requiresPrinterSubmission: false,
    printQuantity: "",
    sizeOrLength: "",
    productionDays: "",
    tags: [],
    driveFolderUrl: "",
    slackChannelId: "",
    creatorIds: [],
    approverIds: [],
    managerIds: [],
    stakeholderIds: [],
    ownerTeam: [],
    productionTeamIds: [],
    relatedTeamIds: [],
    notationCategories: [],
    socialProfileId: "",
  };
}

export function workFormFromWork(work: Work): WorkFormState {
  return {
    title: work.title,
    purpose: work.purpose,
    genre: work.genre ?? "",
    subGenre: work.subGenre ?? "",
    category: work.category,
    mediaType: work.mediaType,
    legacyId: work.legacyId ?? "",
    confidentiality: work.confidentiality,
    deadlineAt: work.deadlineAt ?? null,
    publishAt: work.publishAt ?? null,
    requiresPrinterSubmission: work.requiresPrinterSubmission ?? false,
    printQuantity: work.printQuantity === undefined ? "" : String(work.printQuantity),
    sizeOrLength: work.sizeOrLength ?? "",
    productionDays: work.productionDays === undefined ? "" : String(work.productionDays),
    tags: [...(work.tags ?? [])],
    driveFolderUrl: work.driveFolderUrl ?? "",
    slackChannelId: work.slackChannelId ?? "",
    creatorIds: [...work.creatorIds],
    approverIds: [work.approverId],
    managerIds: [...work.managerIds],
    stakeholderIds: [...(work.stakeholderIds ?? [])],
    ownerTeam: work.ownerTeamId ? [work.ownerTeamId] : [],
    productionTeamIds: [...work.productionTeamIds],
    relatedTeamIds: [...(work.relatedTeamIds ?? [])],
    notationCategories: [...(work.notationCategories ?? [])],
    socialProfileId: work.socialProfileId ?? "",
  };
}

const num = (s: string): number | null => {
  const v = s.normalize("NFKC").replace(/[,，\s]/g, "");
  return v === "" ? null : Number(v);
};

/**
 * Notion に揃えた項目を送る形に直す（null は「無し」。変更では null で消し、登録では null を落として送る）。
 * 数の欄は数に、空は null。小ジャンルから大ジャンル・区分の既定を補う
 */
export function workFormToFields(form: WorkFormState) {
  return {
    genre: form.genre || (form.subGenre ? genreOfSubGenre(form.subGenre) : null),
    subGenre: form.subGenre || null,
    stakeholderIds: form.stakeholderIds,
    publishAt: form.publishAt,
    requiresPrinterSubmission: form.requiresPrinterSubmission,
    printQuantity: num(form.printQuantity),
    sizeOrLength: form.sizeOrLength.trim() || null,
    productionDays: num(form.productionDays),
    tags: form.tags,
    driveFolderUrl: form.driveFolderUrl.trim() || null,
    slackChannelId: form.slackChannelId.trim() || null,
  };
}

/** 登録（create）に渡す形: null の項目は送らない */
export function withoutNulls<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], null> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], null> };
}

/** 登録・保存できるか（必須: 名称・区分（小ジャンルから入る）・制作者・校了権限者） */
export function workFormReady(form: WorkFormState): boolean {
  return (
    form.title.trim() !== "" &&
    form.category.trim() !== "" &&
    form.creatorIds.length > 0 &&
    form.approverIds.length > 0
  );
}

/** 画面の節（M3 のダイアログの中の見出し。質問は Google フォーム風に縦に並ぶ: §50） */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section" aria-label={title}>
      <h3 className="form-section__h">{title}</h3>
      {children}
    </section>
  );
}

/**
 * 小ジャンル（Notion の select）。大ジャンルを選んでいればその中だけ、いなければ大ジャンルごとの組で全部を出す。
 * 選ぶと大ジャンル（未選択なら）・区分・媒体の既定を入れる
 */
function SubGenreSelect({
  genre,
  value,
  onChange,
}: {
  genre: WorkGenre | "";
  value: WorkSubGenre | "";
  onChange: (code: WorkSubGenre | "") => void;
}) {
  const fieldId = useFieldId(undefined);
  const labelId = useFieldLabelId();
  const groups = (genre ? [genre] : workGenres).map((g) => ({ genre: g, items: subGenresOf(g) }));
  return (
    <M3eSelect
      {...(fieldId ? { id: fieldId } : {})}
      {...(labelId ? { "aria-labelledby": labelId } : {})}
      className="select"
      value={value}
      onChange={(e) => {
        const v = (e.target as unknown as { value: string | readonly string[] | null }).value;
        const code = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
        onChange(code as WorkSubGenre | "");
      }}
    >
      <M3eOption value="">未選択</M3eOption>
      {groups.map((g) => (
        <M3eOptGroup key={g.genre}>
          <span slot="label">{workGenreLabels[g.genre]}</span>
          {g.items.map((s) => (
            <M3eOption key={s.code} value={s.code}>
              {s.label}
            </M3eOption>
          ))}
        </M3eOptGroup>
      ))}
    </M3eSelect>
  );
}

/**
 * 登録・編集で共通の入力。節は Notion の制作物 DB の並びに沿って 基本／担当と人／日程と入稿／リンク、
 * 表記統一のカテゴリ、詳細設定（制作物 ID・区分・機密区分・SNS アカウント）。
 */
export function WorkFormFields({
  form,
  setForm,
  mode,
}: {
  form: WorkFormState;
  setForm: (update: (f: WorkFormState) => WorkFormState) => void;
  mode: "create" | "edit";
}) {
  const set = (k: keyof WorkFormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setIds =
    (
      k:
        | "creatorIds"
        | "approverIds"
        | "managerIds"
        | "stakeholderIds"
        | "ownerTeam"
        | "productionTeamIds"
        | "relatedTeamIds",
    ) =>
    (ids: string[]) =>
      setForm((f) => ({ ...f, [k]: ids }));
  // SNS 投稿の制作物: どのアカウント（本体の設定）で投稿するか
  const profiles = useQuery(
    api.social.list,
    mode === "edit" && form.mediaType === "sns" ? {} : "skip",
  );
  const pickGenre = (genre: WorkGenre | "") =>
    setForm((f) => {
      const sub = f.subGenre && genre && genreOfSubGenre(f.subGenre) !== genre ? "" : f.subGenre;
      const next = { ...f, genre, subGenre: sub };
      if (sub === "" && f.subGenre !== "") {
        // 小ジャンルを外したら、小ジャンルから入れていた区分は大ジャンルの名前に
        if (f.category === workSubGenreLabel(f.subGenre))
          next.category = genre ? workGenreLabels[genre] : "";
      } else if (
        !f.subGenre &&
        genre &&
        (f.category === "" || f.category === (f.genre && workGenreLabels[f.genre]))
      )
        next.category = workGenreLabels[genre];
      if (!sub && genre && !f.subGenre)
        next.mediaType = defaultMediaTypeFor(null, genre) ?? f.mediaType;
      return next;
    });
  const pickSubGenre = (code: WorkSubGenre | "") =>
    setForm((f) => {
      const def = workSubGenres.find((s) => s.code === code);
      const prevLabel = workSubGenreLabel(f.subGenre);
      const next = { ...f, subGenre: code };
      if (def) {
        if (!f.genre) next.genre = def.genre;
        // 区分と媒体は既定を入れる（区分は人が書き換えていなければ）
        if (
          f.category === "" ||
          f.category === prevLabel ||
          (f.genre && f.category === workGenreLabels[f.genre])
        )
          next.category = def.label;
        next.mediaType = def.mediaType;
      } else if (prevLabel && f.category === prevLabel)
        next.category = f.genre ? workGenreLabels[f.genre] : "";
      return next;
    });
  return (
    <>
      <FormSection title="基本">
        <Field label="制作物名" required>
          <TextInput
            required
            maxLength={WORK_TITLE_MAX}
            value={form.title}
            onChange={set("title")}
          />
        </Field>
        <Field label="目的・用途">
          <TextArea value={form.purpose} onChange={set("purpose")} />
        </Field>
        <div className="form">
          <Field label="大ジャンル">
            <Select
              value={form.genre}
              onChange={(e) => pickGenre(e.target.value as WorkGenre | "")}
            >
              <option value="">未選択</option>
              {workGenres.map((g) => (
                <option key={g} value={g}>
                  {workGenreLabels[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="小ジャンル" hint="選ぶと区分と媒体の既定が入ります">
            <SubGenreSelect genre={form.genre} value={form.subGenre} onChange={pickSubGenre} />
          </Field>
          <Field
            label="媒体"
            required
            hint="このアプリでの提出・紙面の扱い（PDF・画像・文章・SNS 投稿・動画・Web・Figma）"
          >
            <Select value={form.mediaType} onChange={set("mediaType")}>
              {Object.entries(mediaLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <TagPicker value={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
      </FormSection>

      <FormSection title="担当と人">
        <div className="form">
          <TeamSelect
            label="担当（主管担当）"
            value={form.ownerTeam}
            onChange={setIds("ownerTeam")}
          />
          <TeamSelect
            label="制作担当"
            multi
            value={form.productionTeamIds}
            onChange={setIds("productionTeamIds")}
          />
          <TeamSelect
            label="関係担当"
            multi
            value={form.relatedTeamIds}
            onChange={setIds("relatedTeamIds")}
          />
        </div>
        <UserPicker
          label="制作者"
          required
          value={form.creatorIds}
          onChange={setIds("creatorIds")}
        />
        <UserPicker
          label="校了者（校了権限者）"
          required
          single
          hint="校了を宣言できるのは 1 人（確定方針 C3）"
          value={form.approverIds}
          onChange={setIds("approverIds")}
        />
        <UserPicker
          label="主管・制作統括"
          {...(mode === "create" ? { hint: "登録するあなたは自動で入ります" } : {})}
          value={form.managerIds}
          onChange={setIds("managerIds")}
        />
        <UserPicker
          label="関係者"
          hint="職責ではないので、これだけでは制作物を見られません（閲覧は管理者の閲覧権限で）"
          value={form.stakeholderIds}
          onChange={setIds("stakeholderIds")}
        />
      </FormSection>

      <FormSection title="日程と入稿">
        <div className="form">
          <DateField
            label="納期"
            value={form.deadlineAt}
            onChange={(v) => setForm((f) => ({ ...f, deadlineAt: v }))}
          />
          <DateField
            label="入稿日・投稿日・印刷日"
            kind="date"
            value={form.publishAt}
            onChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
          />
        </div>
        <Checkbox
          checked={form.requiresPrinterSubmission}
          onChange={(on) => setForm((f) => ({ ...f, requiresPrinterSubmission: on }))}
          label="入稿あり（印刷所などへ入稿する制作物）"
        />
        <div className="form">
          <Field label="印刷する部数/枚数/個数">
            <TextInput
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.printQuantity}
              onChange={set("printQuantity")}
            />
          </Field>
          <Field label="サイズ・尺" hint="A4、1080×1350、30 秒 など">
            <TextInput
              maxLength={WORK_SIZE_MAX}
              value={form.sizeOrLength}
              onChange={set("sizeOrLength")}
            />
          </Field>
          <Field label="制作日数">
            <TextInput
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.productionDays}
              onChange={set("productionDays")}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="リンク">
        <div className="form">
          <Field label="Google Drive フォルダ" hint="https://drive.google.com/… の URL">
            <TextInput
              type="url"
              placeholder="https://drive.google.com/drive/folders/…"
              value={form.driveFolderUrl}
              onChange={set("driveFolderUrl")}
            />
          </Field>
          <Field label="Slack Channel ID" hint="C で始まるチャンネル ID（チャンネル名ではなく）">
            <TextInput
              placeholder="C0123ABCDEF"
              value={form.slackChannelId}
              onChange={set("slackChannelId")}
            />
          </Field>
        </div>
      </FormSection>

      <CategoryPicker
        value={form.notationCategories}
        onChange={(codes) => setForm((f) => ({ ...f, notationCategories: codes }))}
      />

      <M3eExpansionPanel className="expansion">
        <span slot="header">
          詳細設定（制作物 ID・区分・機密区分
          {form.mediaType === "sns" && mode === "edit" ? "・SNS アカウント" : ""}）
        </span>
        <div className="form">
          <Field label="制作物 ID" hint="Notion の制作物 ID や過年度の ID">
            <TextInput value={form.legacyId} onChange={set("legacyId")} />
          </Field>
          <Field
            label="区分"
            required
            hint="小ジャンルから自動で入ります。必要なら書き換えられます"
          >
            <TextInput
              required
              maxLength={WORK_CATEGORY_MAX}
              value={form.category}
              onChange={set("category")}
            />
          </Field>
          <Field label="機密区分">
            <Select value={form.confidentiality} onChange={set("confidentiality")}>
              <option value="normal">通常</option>
              <option value="restricted">非公開・取扱注意</option>
            </Select>
          </Field>
          {mode === "edit" && form.mediaType === "sns" ? (
            <Field label="SNS アカウント" hint="管理 › SNS アカウントで登録したもの">
              <Select value={form.socialProfileId} onChange={set("socialProfileId")}>
                <option value="">未設定</option>
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {socialPlatformLabels[p.platform]} @{p.username}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </M3eExpansionPanel>
    </>
  );
}
