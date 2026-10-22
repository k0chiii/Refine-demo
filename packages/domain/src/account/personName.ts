/**
 * 人の名前の出し方（利用者指示 2026-10-21「名前は漢字じゃなくてひらがなで。表示名も検索も」）。
 * Nogiku の userinfo の `hurigana`（ふりがな）を表示名にし、無い人だけ `name`（漢字の名前）を出す。
 * ふりがながカタカナ・半角で届いても、ひらがなにそろえて出す。
 * 検索は ひらがな・カタカナ・漢字の名前・メールのどれで打っても当たる。
 */

/** 名前の項目（users の行・名簿の行の部分） */
export interface PersonNameFields {
  /** Nogiku の name（漢字の名前） */
  name?: string | null | undefined;
  /** Nogiku の hurigana（ふりがな） */
  hurigana?: string | null | undefined;
  email?: string | null | undefined;
}

/** カタカナ（全角・半角）をひらがなに。ほかの文字はそのまま（NFKC で半角カナ・全角英数もそろえる） */
export function toHiragana(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** ふりがな（ひらがなにそろえる。空白のゆれは 1 つに）。無ければ null */
export function huriganaOf(person: PersonNameFields): string | null {
  const kana = toHiragana(person.hurigana ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return kana === "" ? null : kana;
}

/** 画面・通知に出す名前: ふりがな（ひらがな）。無ければ漢字の名前。どちらも無ければ空 */
export function personDisplayName(person: PersonNameFields): string {
  return huriganaOf(person) ?? person.name?.trim() ?? "";
}

/** 検索・照合用にそろえる（ひらがな・小文字・空白を除く） */
function searchKey(text: string): string {
  return toHiragana(text).toLowerCase().replace(/\s+/g, "");
}

/**
 * 検索語に当たるか: ふりがな・漢字の名前・メールのどれかに含まれれば当たる（空の検索語はすべて当たる）。
 * カタカナで打ってもひらがなで打っても同じ。名前の途中の空白（「ほんごう こうせい」）は無視する
 */
export function personMatchesText(person: PersonNameFields, text: string): boolean {
  const q = searchKey(text);
  if (q === "") return true;
  return [person.hurigana, person.name, person.email].some(
    (v) => typeof v === "string" && searchKey(v).includes(q),
  );
}
