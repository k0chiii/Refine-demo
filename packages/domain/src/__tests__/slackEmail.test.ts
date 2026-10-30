import { describe, expect, it } from "vite-plus/test";
import { normalizeSlackEmail, validateSlackEmail } from "../index.ts";

const invalid = expect.objectContaining({
  code: "notification_prefs_invalid",
  details: { field: "slackEmail" },
});

describe("Slack のメールアドレス（各自が書く。§110）", () => {
  it("前後の空白を除き、小文字にそろえる", () => {
    expect(normalizeSlackEmail("  Kenta.Ochi@Example-Org.JP \n")).toBe("kenta.ochi@example-org.jp");
  });

  it("全角で打ったアドレスも半角にそろえる", () => {
    expect(normalizeSlackEmail("ｋｅｎｔａ＠ｅｘａｍｐｌｅ－ｏｒｇ．ｊｐ")).toBe(
      "kenta@example-org.jp",
    );
  });

  it("予約済みのドメインでも形が正しければ残す（送るかの決まりは Nogiku のアドレスだけに当てる）", () => {
    expect(normalizeSlackEmail("someone@example.invalid")).toBe("someone@example.invalid");
  });

  it("形が正しくなければ null（@ が 1 つ・空白なし・ドメインに点がある）", () => {
    for (const raw of [
      "",
      "kenta",
      "kenta@",
      "@example-org.jp",
      "kenta@localhost",
      "ken ta@example-org.jp",
      "a@b@example-org.jp",
      "kenta@example-org.",
      "kenta@.jp",
    ])
      expect(normalizeSlackEmail(raw)).toBeNull();
  });

  it("利用者が送ったものは、空・null なら消し（null）、形が正しくなければ受け付けない", () => {
    expect(validateSlackEmail(" Kenta@Example-Org.JP ")).toBe("kenta@example-org.jp");
    for (const raw of [null, "", "   ", "　"]) expect(validateSlackEmail(raw)).toBeNull();
    for (const raw of ["kenta", "kenta@example-org", "ken ta@example-org.jp"])
      expect(() => validateSlackEmail(raw)).toThrow(invalid);
  });
});
