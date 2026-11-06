import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { M3eIcon } from "@m3e/react/icon";
import { M3eSearchBar } from "@m3e/react/search";

/**
 * アプリバーの検索（Google ドライブ式）。入力は制作物一覧の `q` に反映し、一覧以外の画面からは一覧へ移動する。
 * 2026-10-14 利用者判断で一旦外した（アプリバーから呼ばなくなった）。戻すときは `_app.tsx` の題名スロットに置く。
 */
export function WorkSearch({ trailing }: { trailing?: ReactNode }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { q?: string };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onList = path === "/works" || path === "/works/";
  const [text, setText] = useState(search.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setText(onList ? (search.q ?? "") : "");
  }, [search.q, onList]);
  const apply = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void navigate({ to: "/works", search: q ? { q } : {}, replace: onList });
    }, 250);
  };
  return (
    <M3eSearchBar
      className="search search--appbar"
      clearable
      onClear={() => {
        setText("");
        apply("");
      }}
    >
      <M3eIcon slot="leading" name="search" />
      <input
        slot="input"
        placeholder="制作物を検索"
        aria-label="制作物を検索"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          apply(e.target.value);
        }}
      />
      {trailing}
    </M3eSearchBar>
  );
}
