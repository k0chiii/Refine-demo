import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { describeError } from "@/lib/errors";
import { Field, Select, TextInput } from "@/ui/Field";
import { M3eButton, M3eIcon } from "@/ui/m3e";

export const Route = createFileRoute("/signin")({ component: SignIn });

/** モック環境で切り替えられる委員（apps/convex/convex/seed.ts と同じ sub）。 */
const MOCK_USERS = [
  { sub: "mock-nogiku-admin", name: "五月 管理（システム管理者）" },
  { sub: "mock-nogiku-manager", name: "五月 主管（制作統括）" },
  { sub: "mock-nogiku-creator", name: "五月 めい（制作者）" },
  { sub: "mock-nogiku-reviewer", name: "本郷 校正（校正者）" },
  { sub: "mock-nogiku-approver", name: "駒場 校了（校了権限者）" },
];

function SignIn() {
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.me.me, isAuthenticated ? {} : "skip");
  const [error, setError] = useState<string | null>(null);
  const [mockSub, setMockSub] = useState(MOCK_USERS[2]!.sub);
  const [customSub, setCustomSub] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated && me) void navigate({ to: "/queue", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  // モックかどうかはサーバー設定（NOGIKU_MOCK_ENABLED）が正本。未ログインでは分からないので dev ビルドでのみ UI を出す。
  const showMock = import.meta.env.DEV;

  const start = async (params: Record<string, string>) => {
    setError(null);
    try {
      const result = await signIn("nogiku", params);
      if (!result.redirect) void navigate({ to: "/queue", replace: true });
    } catch (e) {
      setError(describeError(e).message);
    }
  };

  return (
    <main className="signin">
      <div className="signin__card">
        <h1 style={{ margin: 0, fontSize: 24 }}>MF100 校正システム</h1>
        <p className="muted" style={{ margin: 0 }}>
          委員共通アカウント（Nogiku）でサインインします。このシステムはパスワードを保持しません。
        </p>
        <M3eButton variant="filled" onClick={() => start({ redirectTo: "/queue" })}>
          <M3eIcon slot="icon">login</M3eIcon>
          Nogiku でサインイン
        </M3eButton>
        {error ? <div className="alert">{error}</div> : null}
        {showMock ? (
          <details>
            <summary className="small muted">
              開発用: モック委員でサインイン（NOGIKU_MOCK_ENABLED=true のデプロイメントのみ）
            </summary>
            <div className="stack" style={{ marginTop: 12 }}>
              <Field label="役割">
                <Select value={mockSub} onChange={(e) => setMockSub(e.target.value)}>
                  {MOCK_USERS.map((u) => (
                    <option key={u.sub} value={u.sub}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="任意の sub（空なら上の役割）">
                <TextInput
                  value={customSub}
                  onChange={(e) => setCustomSub(e.target.value)}
                  placeholder="mock-nogiku-xxx"
                />
              </Field>
              <M3eButton variant="tonal" onClick={() => start({ sub: customSub || mockSub })}>
                モックでサインイン
              </M3eButton>
            </div>
          </details>
        ) : null}
      </div>
    </main>
  );
}
