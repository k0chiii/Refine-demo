import { WORK_TAG_LENGTH_MAX, WORK_TAG_MAX, workTagOptions } from "@mf100/domain";
import type { M3eOptionElement } from "@m3e/web/option";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eInputChip } from "@m3e/react/chips";
import { M3eOption } from "@m3e/react/option";
import { isImeKeyEvent } from "@/lib/ime";

/** タグの色の数（M3 のトーナル container 5 色。tag-tone-0〜4。styles.css） */
const TONES = 5;

/**
 * タグの文字列から決まる色（保存しない。同じ語はいつも同じ色）。
 * 文字のコードを足し込む軽い hash で 0〜4 に振る。
 */
export function tagTone(tag: string): number {
  let h = 0;
  for (const ch of tag) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % TONES;
}

const normalize = (raw: string) => raw.normalize("NFKC").trim();

type Row = { kind: "tag"; label: string } | { kind: "create"; label: string };

/**
 * タグ（Notion の制作物 DB の multi_select）。Notion の multi-select のように、1 つの欄の中にチップを並べ、
 * 欄をクリックすると候補が開く。書くと既存のタグを絞り込み、同じ語がなければ「「xxx」を作成」が出る。
 *
 * キーボード: Enter で選ぶ（候補が無ければ書いた語を作る）、↑/↓ で候補を移る、
 * 何も書いていない欄で Backspace を押すと最後のチップを外す、Esc で候補を閉じる。
 * 追加しても入力欄にフォーカスを残すので、続けて何個でも入れられる。
 * a11y: 入力は role=combobox（aria-activedescendant）、候補は role=listbox / option。
 */
export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<number, M3eOptionElement>());
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");

  const full = value.length >= WORK_TAG_MAX;
  const typed = normalize(text);
  const rows = useMemo<Row[]>(() => {
    if (full) return [];
    const q = typed.toLowerCase();
    const out: Row[] = workTagOptions
      .filter((t) => !value.includes(t) && (q === "" || t.toLowerCase().includes(q)))
      .map((label) => ({ kind: "tag", label }));
    const exists = q !== "" && [...workTagOptions, ...value].some((t) => t.toLowerCase() === q);
    if (q !== "" && !exists) out.push({ kind: "create", label: typed });
    return out;
  }, [typed, value, full]);
  const listShown = open && rows.length > 0;
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);

  // 候補の先頭を選んだ状態に戻す（書き換えたとき・追加したとき）
  useEffect(() => setActive(0), [typed, value.length]);

  // 選択中の候補を M3E option の state layer で示し、見える位置まで送る（キーボードで選んでいるときの目印）
  useEffect(() => {
    for (const [i, el] of optionRefs.current) {
      if (i === activeIndex && listShown) {
        el.stateLayer?.show("focused");
        el.scrollIntoView({ block: "nearest" });
      } else el.stateLayer?.hide("focused");
    }
  }, [activeIndex, listShown, rows]);

  // 候補が開いたら、ダイアログの中でも候補が見える位置まで送る（欄は画面の下の方にあることがある）
  useEffect(() => {
    if (!listShown) return;
    menuRef.current?.scrollIntoView({ block: "nearest" });
  }, [listShown]);

  // Esc: 候補が開いているときは候補を閉じるだけにする（ダイアログまで閉じない）。
  // M3E のダイアログは自分の keydown で閉じるので、React の合成イベントでは間に合わない。入力の親で native の listener を使う
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    root.addEventListener("keydown", onEsc);
    return () => root.removeEventListener("keydown", onEsc);
  }, []);

  // 欄の外を押したら閉じる（フォーカスが外に出たときは onBlur 側で閉じる）
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const add = (raw: string) => {
    const t = normalize(raw);
    if (t === "") return;
    // 大文字小文字だけ違う語は、Notion にある綴りに寄せる
    const canonical = [...workTagOptions, ...value].find(
      (x) => x.toLowerCase() === t.toLowerCase(),
    );
    const tag = canonical ?? t;
    setText("");
    if (value.includes(tag) || value.length >= WORK_TAG_MAX) return;
    onChange([...value, tag]);
    setAnnounce(`「${tag}」を追加しました`);
  };
  const remove = (tag: string) => {
    onChange(value.filter((x) => x !== tag));
    setAnnounce(`「${tag}」を外しました`);
    inputRef.current?.focus();
  };
  const pick = (row: Row) => {
    add(row.label);
    // 追加してもフォーカスは入力欄に残し、候補は開いたままにする
    inputRef.current?.focus();
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語入力の変換確定の Enter / 矢印は触らない
    if (isImeKeyEvent(e.nativeEvent)) return;
    switch (e.key) {
      case "Enter": {
        e.preventDefault();
        const row = listShown ? rows[activeIndex] : undefined;
        if (row) pick(row);
        else if (typed !== "") add(typed);
        break;
      }
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          break;
        }
        if (rows.length === 0) break;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + rows.length) % rows.length);
        break;
      }
      case "Backspace": {
        const last = value[value.length - 1];
        if (text === "" && last !== undefined) {
          e.preventDefault();
          onChange(value.slice(0, -1));
          setAnnounce(`「${last}」を外しました`);
        }
        break;
      }
      default:
    }
  };

  return (
    <div ref={rootRef} className="picker tag-picker" role="group" aria-labelledby={`${id}-label`}>
      <M3eFormField variant="outlined" className="field" floatLabel="always" hideSubscript="never">
        <label slot="label" htmlFor={inputId} id={`${id}-label`}>
          タグ
        </label>
        {/* 欄全体が 1 つの入力に見える（チップと入力が同じ枠の中）。欄のどこを押しても入力にフォーカスして候補を開く。候補はこの欄の下に開く */}
        <div className="tag-anchor">
          <div
            className="tag-field"
            data-open={listShown ? "" : undefined}
            onPointerDown={(e) => {
              // チップの「外す」ボタンなどは、その操作に任せる
              if ((e.target as HTMLElement).closest("m3e-input-chip")) return;
              if (e.target !== inputRef.current) {
                e.preventDefault();
                inputRef.current?.focus();
              }
              setOpen(true);
            }}
          >
            {value.length > 0 ? (
              <div className="tag-field__chips" role="grid" aria-label="選んだタグ">
                {value.map((t) => (
                  <M3eInputChip
                    key={t}
                    variant="elevated"
                    className={`tag-chip tag-tone-${tagTone(t)}`}
                    removable
                    removeLabel={`${t} を外す`}
                    onRemove={() => remove(t)}
                  >
                    {t}
                  </M3eInputChip>
                ))}
              </div>
            ) : null}
            <input
              ref={inputRef}
              id={inputId}
              className="input tag-field__input"
              role="combobox"
              aria-expanded={listShown}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-describedby={`${id}-hint`}
              {...(listShown && activeIndex >= 0
                ? { "aria-activedescendant": `${id}-opt-${activeIndex}` }
                : {})}
              autoComplete="off"
              value={text}
              maxLength={WORK_TAG_LENGTH_MAX}
              placeholder={value.length === 0 ? "タグを選ぶ・書く" : ""}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              onBlur={(e) => {
                // 欄の外へ出るとき: 書きかけの語は作って閉じる（押し忘れで消えない）
                if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
                if (typed !== "") add(typed);
                setOpen(false);
              }}
            />
          </div>
          {open && (rows.length > 0 || full) ? (
            <div ref={menuRef} className="tag-menu">
              {rows.length > 0 ? (
                <div
                  id={listId}
                  role="listbox"
                  aria-label="タグの候補"
                  // 候補を押してもフォーカスを入力欄から動かさない
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {rows.map((row, i) => (
                    <M3eOption
                      key={`${row.kind}:${row.label}`}
                      id={`${id}-opt-${i}`}
                      value={row.label}
                      ref={(el: M3eOptionElement | null) => {
                        if (el) optionRefs.current.set(i, el);
                        else optionRefs.current.delete(i);
                      }}
                      className="tag-menu__option"
                      onClick={() => pick(row)}
                      onPointerMove={() => setActive(i)}
                    >
                      {row.kind === "create" ? (
                        <span className="tag-menu__create">「{row.label}」を作成</span>
                      ) : (
                        <span className={`tag-dot tag-tone-${tagTone(row.label)}`}>
                          {row.label}
                        </span>
                      )}
                    </M3eOption>
                  ))}
                </div>
              ) : (
                <p className="tag-menu__note">タグは {WORK_TAG_MAX} 個までです</p>
              )}
            </div>
          ) : null}
        </div>
        <span slot="hint" id={`${id}-hint`}></span>
      </M3eFormField>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
