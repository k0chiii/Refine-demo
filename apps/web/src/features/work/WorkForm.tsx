import { api } from "@mf100/convex/api";
import {
  approvalTargetFromFinish,
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
  ControlledSelect,
  Field,
  Select,
  Switch,
  TextArea,
  TextInput,
  useFieldId,
  useFieldLabelId,
} from "@/ui/Field";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { M3eOptGroup, M3eOption } from "@m3e/react/option";
import { UserPicker } from "@/ui/UserPicker";
import { CategoryPicker } from "@/features/notation/CategoryPicker";
import { ApproverFields } from "./ApproverFields";
import { selectableApprovers, withoutCreatorsAsApprovers } from "./approverSelection";
import { clampQuorum } from "./clampQuorum";
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
  /** ◆校了目標日（deadlineAt） */
  deadlineAt: number | null;
  /** ■仕上がり日 */
  finishAt: number | null;
  /** ◆を手で直したあとは自動計算しない（画面だけ） */
  approvalTargetManual: boolean;
  publishAt: number | null;
  requiresPrinterSubmission: boolean;
  printQuantity: string;
  sizeOrLength: string;
  productionDays: string;
  tags: string[];
  creatorIds: string[];
  approverIds: string[];
  /** 校了とみなす人数（画面の値は文字列。校了者が 1 人のときは 1） */
  approvalQuorum: string;
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
    finishAt: null,
    approvalTargetManual: false,
    publishAt: null,
    requiresPrinterSubmission: false,
    printQuantity: "",
    sizeOrLength: "",
    productionDays: "",
    tags: [],
    creatorIds: [],
    approverIds: [],
    approvalQuorum: "1",
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
  // 決定（2026-10-18）より前に保存された行では制作者が校了者に入っていることがある。フォームには出さない（保存で外れる）
  const approverIds = selectableApprovers(work.approverIds ?? [work.approverId], work.creatorIds);
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
    finishAt: work.finishAt ?? null,
    approvalTargetManual: false,
    publishAt: work.publishAt ?? null,
    requiresPrinterSubmission: work.requiresPrinterSubmission ?? false,
    printQuantity: work.printQuantity === undefined ? "" : String(work.printQuantity),
    sizeOrLength: work.sizeOrLength ?? "",
    productionDays: work.productionDays === undefined ? "" : String(work.productionDays),
    tags: [...(work.tags ?? [])],
    creatorIds: [...work.creatorIds],
    approverIds,
    approvalQuorum: String(clampQuorum(work.approvalQuorum ?? 1, approverIds.length)),
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

const prepDaysFromForm = (form: WorkFormState): number => num(form.productionDays) ?? 0;

function withFinishAt(form: WorkFormState, finishAt: number | null): WorkFormState {
  const next = { ...form, finishAt };
  if (!form.approvalTargetManual && finishAt != null) {
    next.deadlineAt = approvalTargetFromFinish(finishAt, prepDaysFromForm(form));
  }
  return next;
}

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

/** 登録・更新に渡す校了者と人数（人数は 1..校了者の数に収める） */
export function approversFromForm(form: Pick<WorkFormState, "approverIds" | "approvalQuorum">) {
  return {
    approverIds: form.approverIds,
    approvalQuorum: clampQuorum(form.approvalQuorum, form.approverIds.length),
  };
}

/** 登録・保存できるか（編集: 名称・区分・制作者・校了する人。登録: 名称・小ジャンル・制作者・仕上がり日） */
export function workFormReady(form: WorkFormState, mode: "create" | "edit" = "edit"): boolean {
  if (mode === "create") {
    return (
      form.title.trim() !== "" &&
      form.subGenre !== "" &&
      form.creatorIds.length > 0 &&
      form.finishAt !== null
    );
  }
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
    <ControlledSelect
      {...(fieldId ? { id: fieldId } : {})}
      {...(labelId ? { "aria-labelledby": labelId } : {})}
      className="select"
      value={value}
      onValueChange={(values) => onChange((values[0] ?? "") as WorkSubGenre | "")}
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
    </ControlledSelect>
  );
}

/**
 * 登録・編集で共通の入力。節は Notion の制作物 DB の並びに沿って 基本／担当と人／日程と入稿、
 * 表記統一のカテゴリ、詳細設定（区分・機密区分・SNS アカウント）。
 */
export function WorkFormFields({
  form,
  setForm,
  mode,
  canAssignApprovers = true,
}: {
  form: WorkFormState;
  setForm: (update: (f: WorkFormState) => WorkFormState) => void;
  mode: "create" | "edit";
  /** 校了者を決める権限（approvers:assign）。無い人には、編集で校了者を見るだけにする（登録はこの権限が要る） */
  canAssignApprovers?: boolean;
}) {
  const set = (k: keyof WorkFormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setIds =
    (
      k:
        | "creatorIds"
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
  if (mode === "create") {
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
          <Field label="小ジャンル" required hint="選ぶと区分と媒体の既定が入ります">
            <SubGenreSelect genre={form.genre} value={form.subGenre} onChange={pickSubGenre} />
          </Field>
          <UserPicker
            label="制作者"
            required
            value={form.creatorIds}
            onChange={(ids) =>
              setForm((f) => withoutCreatorsAsApprovers({ ...f, creatorIds: ids }))
            }
          />
          <DateField
            label="■仕上がり日"
            kind="date"
            value={form.finishAt}
            onChange={(v) => setForm((f) => withFinishAt(f, v))}
          />
        </FormSection>
      </>
    );
  }

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
          <Field label="媒体" required>
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
          <TeamSelect label="担当" value={form.ownerTeam} onChange={setIds("ownerTeam")} />
          <TeamSelect
            label="制作担当"
            hint="1 つ（あとから変えられます）"
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
          onChange={(ids) => setForm((f) => withoutCreatorsAsApprovers({ ...f, creatorIds: ids }))}
        />
        <ApproverFields
          required
          {...(mode === "edit" && !canAssignApprovers ? { readOnly: true } : {})}
          ids={form.approverIds}
          excludeIds={form.creatorIds}
          quorum={form.approvalQuorum}
          onChange={(next) =>
            setForm((f) => ({ ...f, approverIds: next.ids, approvalQuorum: next.quorum }))
          }
        />
        <UserPicker label="統括" value={form.managerIds} onChange={setIds("managerIds")} />
        <UserPicker
          label="関係者"
          hint="見るだけの人です（非公開でも見られます）"
          value={form.stakeholderIds}
          onChange={setIds("stakeholderIds")}
        />
      </FormSection>

      <FormSection title="日程と入稿">
        <div className="form">
          <DateField
            label="■仕上がり日"
            kind="date"
            value={form.finishAt}
            onChange={(v) => setForm((f) => withFinishAt(f, v))}
          />
          <DateField
            label="◆校了目標日"
            value={form.deadlineAt}
            onChange={(v) => setForm((f) => ({ ...f, deadlineAt: v, approvalTargetManual: true }))}
          />
          <DateField
            label="入稿日・投稿日・印刷日"
            kind="date"
            value={form.publishAt}
            onChange={(v) => setForm((f) => ({ ...f, publishAt: v }))}
          />
        </div>
        <div data-field="requiresPrinterSubmission">
          <Switch
            checked={form.requiresPrinterSubmission}
            onChange={(on) => setForm((f) => ({ ...f, requiresPrinterSubmission: on }))}
            label="入稿あり（印刷所などへ入稿する制作物）"
          />
        </div>
        {/* 切って隠しても値は消さずに送る（入稿なしの制作物にもサイズ・尺「30 秒」などがある。UI_M3E §108） */}
        {form.requiresPrinterSubmission ? (
          <div className="form" data-fields="submission">
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
        ) : null}
      </FormSection>

      <CategoryPicker
        value={form.notationCategories}
        onChange={(codes) => setForm((f) => ({ ...f, notationCategories: codes }))}
      />

      <M3eExpansionPanel className="expansion">
        <span slot="header">
          詳細設定（区分・機密区分
          {form.mediaType === "sns" && mode === "edit" ? "・SNS アカウント" : ""}）
        </span>
        <div className="form">
          <Field label="区分" required>
            <TextInput
              required
              maxLength={WORK_CATEGORY_MAX}
              value={form.category}
              onChange={set("category")}
            />
          </Field>
          <Field label="機密区分" hint="非公開・取扱注意は関係者だけが見られます">
            <Select value={form.confidentiality} onChange={set("confidentiality")}>
              <option value="normal">通常</option>
              <option value="restricted">非公開・取扱注意</option>
            </Select>
          </Field>
          {mode === "edit" && form.mediaType === "sns" ? (
            <Field label="SNS アカウント">
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
