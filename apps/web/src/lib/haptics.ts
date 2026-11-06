/**
 * 軽い触覚フィードバック（長押しで選択が始まった・コメントの位置を置いた、などの手応え）。
 * - Android の Chrome など: Vibration API（10ms）
 * - iPhone の Safari は Vibration API が無い。iOS 18 以降は「スイッチの見た目の checkbox」（`<input type="checkbox" switch>`）を
 *   押すと端末が軽く震えるので、画面に出さないスイッチのラベルを押して代わりにする。利用者の操作の中でないと震えないことがある
 * どちらも無い端末では何もしない（見た目のフィードバックだけ）
 */
let iosSwitch: HTMLLabelElement | null = null;

function iosHaptic() {
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic() {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(10);
    return;
  }
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.maxTouchPoints > 1) {
    try {
      iosHaptic();
    } catch {
      // 震えなくても操作は続ける
    }
  }
}
