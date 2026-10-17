import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { describeError } from "@/lib/errors";
import { Card } from "@/ui/Card";
import { Field, Select, TextInput } from "@/ui/Field";
import { M3eButton } from "@m3e/react/button";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { M3eHeading } from "@m3e/react/heading";
import { toast } from "@/lib/toast";

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
  const [mockSub, setMockSub] = useState(MOCK_USERS[2]!.sub);
  const [customSub, setCustomSub] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated && me) void navigate({ to: "/", replace: true });
  }, [isLoading, isAuthenticated, me, navigate]);

  // モックかどうかはサーバー設定（NOGIKU_MOCK_ENABLED）が正本。未ログインでは分からないので dev ビルドでのみ UI を出す。
  const showMock = import.meta.env.DEV || import.meta.env.MODE === "demo";

  const start = async (params: Record<string, string>) => {
    try {
      const result = await signIn("nogiku", params);
      if (!result.redirect) void navigate({ to: "/", replace: true });
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    }
  };

  return (
    <main className="signin">
      <Card variant="elevated" className="signin__card">
        <div className="signin__brand">
          <img src="/icons/icon-192.png" alt="" width={64} height={64} className="signin__logo" />
          <M3eHeading variant="headline" size="small" level={1} emphasized style={{ margin: 0 }}>
            校正システム
          </M3eHeading>
        </div>
        <M3eButton variant="filled" size="medium" onClick={() => start({ redirectTo: "/" })}>
          Nogiku でサインイン
        </M3eButton>
        {showMock ? (
          <M3eExpansionPanel className="expansion">
            <span slot="header">モックのユーザーでサインイン</span>
            <div className="stack">
              <Field label="役割">
                <Select value={mockSub} onChange={(e) => setMockSub(e.target.value)}>
                  {MOCK_USERS.map((u) => (
                    <option key={u.sub} value={u.sub}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="任意の sub（省略可）">
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
          </M3eExpansionPanel>
        ) : null}
      </Card>
    </main>
  );
}
