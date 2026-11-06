/**
 * M3E の date-input（年・月・日・時・分の欄）で、日本語入力のまま打った数字も受け付ける。
 *
 * 欄は contenteditable で、数字は keydown の半角 0〜9 だけを受ける。日本語入力がオンだとキーは「Process」で届いて
 * 捨てられる一方、確定した全角の「１５」は欄にそのまま書き込まれる。部品の値は変わらないまま、表示だけ「１５」になり、
 * 打ち直しても直らなかった（MF100 Notion「日付の登録で、入力日にちが1桁になり編集できない」）。
 *
 * ここでは書き込まれた文字を元に戻し（部品が描いた文字のノードはそのまま残す）、半角に直した数字を keydown として渡す。
 * 返り値は外すための関数
 */
export function acceptImeDigits(host: HTMLElement): () => void {
  let saved: { field: HTMLElement; nodes: [Node, string | null][] } | null = null;

  const save = (e: Event) => {
    if (saved) return;
    const field = e.composedPath()[0];
    if (!(field instanceof HTMLElement) || !field.isContentEditable) return;
    saved = { field, nodes: [...field.childNodes].map((n) => [n, n.nodeValue]) };
  };
  const commit = (text: string) => {
    if (!saved) return;
    const { field, nodes } = saved;
    saved = null;
    const own = new Set(nodes.map(([n]) => n));
    for (const n of [...field.childNodes]) if (!own.has(n)) n.remove();
    for (const [n, value] of nodes) {
      if (n.parentNode !== field) field.append(n);
      if (n.nodeValue !== value) n.nodeValue = value;
    }
    for (const key of text.normalize("NFKC").replace(/\D/g, ""))
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }),
      );
  };
  const onCompositionEnd = (e: Event) => commit((e as CompositionEvent).data ?? "");
  // 全角の数字をそのまま確定する入力（変換を経ない）は compositionend が来ない
  const onInput = (e: Event) => {
    const ev = e as InputEvent;
    if (!ev.isComposing && ev.inputType === "insertText") commit(ev.data ?? "");
  };

  const forget = () => {
    saved = null;
  };

  host.addEventListener("compositionstart", save);
  host.addEventListener("beforeinput", save);
  host.addEventListener("compositionend", onCompositionEnd);
  host.addEventListener("input", onInput);
  host.addEventListener("focusout", forget);
  return () => {
    host.removeEventListener("focusout", forget);
    host.removeEventListener("compositionstart", save);
    host.removeEventListener("beforeinput", save);
    host.removeEventListener("compositionend", onCompositionEnd);
    host.removeEventListener("input", onInput);
  };
}
