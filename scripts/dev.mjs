import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import readline from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = join(root, ".logs");
const MAX_LINES = 4000;

const SERVICES = [
  { name: "convex", cwd: "apps/convex" },
  { name: "api", cwd: "apps/api" },
  { name: "web", cwd: "apps/web" },
];

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !SERVICES.some((service) => service.name === name));
if (unknown.length > 0) {
  console.error(`不明なサービス: ${unknown.join(", ")}（convex / api / web）`);
  process.exit(1);
}

const selected = requested.length
  ? SERVICES.filter((service) => requested.includes(service.name))
  : SERVICES;

mkdirSync(logDir, { recursive: true });

const useTui = Boolean(process.stdout.isTTY && process.stdin.isTTY);
const tabs = [];
let active = 0;
let shuttingDown = false;
let failed = false;
let finished = false;
let restored = false;

for (const service of selected) {
  const logPath = join(logDir, `${service.name}.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  log.write(`# ${service.name} started ${new Date().toISOString()}\n`);

  const child = spawn("pnpm", ["dev"], {
    cwd: join(root, service.cwd),
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tab = {
    name: service.name,
    child,
    log,
    lines: [],
    follow: true,
    offset: 0,
    exited: false,
  };
  tabs.push(tab);

  const writeLine = (line) => {
    log.write(`${line}\n`);
    tab.lines.push(line);
    if (tab.lines.length > MAX_LINES) tab.lines.shift();
    if (useTui) scheduleRender();
    else process.stdout.write(`${service.name.padEnd(6)} ${line}\n`);
  };

  for (const stream of [child.stdout, child.stderr]) {
    attachLines(stream, (line) => writeLine(lastCarriage(stripAnsi(line))));
  }

  child.on("exit", (code, signal) => {
    tab.exited = true;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    writeLine(`終了 (${reason})`);
    log.end();
    if (!shuttingDown && (signal || (code !== 0 && code !== null))) {
      failed = true;
      active = tabs.indexOf(tab);
      if (!useTui)
        console.error(`${service.name} が異常終了しました。ログ: .logs/${service.name}.log`);
    }
    if (useTui) scheduleRender();
    if (tabs.every((item) => item.exited)) finish(shuttingDown || !failed ? 0 : 1);
  });
}

if (useTui) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", onKey);
  process.stdout.write("\x1b[?1049h\x1b[2J");
  process.stdout.on("resize", render);
  render();
} else {
  console.log("MF100 refine を起動します。Ctrl+C で全部停止します。");
  for (const tab of tabs) console.log(`  ${tab.name.padEnd(6)}  .logs/${tab.name}.log`);
}

function onKey(_str, key) {
  if (!key) return;
  if (key.ctrl && key.name === "c") {
    shutdown();
    return;
  }
  const tab = tabs[active];
  if (!tab) return;
  if (key.name === "tab" && key.shift) moveTab(-1);
  else if (key.name === "tab" || key.name === "right") moveTab(1);
  else if (key.name === "left") moveTab(-1);
  else if (
    typeof key.sequence === "string" &&
    key.sequence >= "1" &&
    key.sequence <= String(tabs.length)
  ) {
    active = Number(key.sequence) - 1;
    render();
  } else if (key.name === "up") scroll(1);
  else if (key.name === "down") scroll(-1);
  else if (key.name === "pageup") scroll(bodyRows());
  else if (key.name === "pagedown") scroll(-bodyRows());
  else if (key.name === "end") {
    tab.follow = true;
    tab.offset = 0;
    render();
  }
}

function moveTab(delta) {
  active = (active + delta + tabs.length) % tabs.length;
  render();
}

function scroll(delta) {
  const tab = tabs[active];
  if (!tab) return;
  const maxOffset = Math.max(0, tab.lines.length - bodyRows());
  tab.follow = false;
  tab.offset = Math.min(maxOffset, Math.max(0, tab.offset + delta));
  if (tab.offset === 0) tab.follow = true;
  render();
}

let renderQueued = false;
function scheduleRender() {
  if (!useTui || renderQueued || shuttingDown || finished) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 16);
}

function render() {
  if (!useTui || finished) return;
  const columns = Math.max(20, process.stdout.columns || 80);
  const rows = Math.max(6, process.stdout.rows || 24);
  const height = rows - 2;
  const tab = tabs[active];
  const total = tab?.lines.length ?? 0;
  const maxOffset = Math.max(0, total - height);
  if (tab?.follow) tab.offset = 0;
  else if (tab) tab.offset = Math.min(tab.offset, maxOffset);
  const end = total - (tab?.offset ?? 0);
  const start = Math.max(0, end - height);
  const view = tab ? tab.lines.slice(start, end) : [];

  let out = "\x1b[?25l";
  out += place(1, tabBar(), columns);
  for (let i = 0; i < height; i++) {
    out += place(i + 2, view[i] ?? "", columns);
  }
  out += place(rows, footer(), columns);
  process.stdout.write(out);
}

function tabBar() {
  return tabs
    .map((tab, index) => {
      const label = ` ${index + 1} ${tab.name}${tab.exited ? " ×" : ""} `;
      return index === active ? `\x1b[7m${label}\x1b[0m` : label;
    })
    .join("");
}

function footer() {
  const tab = tabs[active];
  const mode = tab?.follow ? "末尾" : "スクロール中 (End で末尾)";
  return `Tab / ← → / 1-${tabs.length} で切替    ↑↓ で戻る    ${mode}    Ctrl+C で全部停止`;
}

function bodyRows() {
  return Math.max(1, (process.stdout.rows || 24) - 2);
}

function place(row, text, columns) {
  return `\x1b[${row};1H\x1b[2K${clipAnsi(text, columns - 1)}`;
}

function finish(code) {
  if (finished) return;
  finished = true;
  restoreTerminal();
  if (shuttingDown) console.log("停止しました。");
  process.exit(code);
}

function restoreTerminal() {
  if (restored || !useTui) return;
  restored = true;
  process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[0m");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

function shutdown() {
  if (shuttingDown) {
    for (const tab of tabs) forceKill(tab.child);
    finish(1);
    return;
  }
  shuttingDown = true;
  restoreTerminal();
  console.log("停止しています…");
  for (const tab of tabs) stop(tab.child);
  setTimeout(() => {
    for (const tab of tabs) {
      if (!tab.exited) forceKill(tab.child);
    }
    finish(0);
  }, 4000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function attachLines(stream, onLine) {
  if (!stream) return;
  let pending = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    let newline = pending.indexOf(0x0a);
    while (newline !== -1) {
      const line = pending.subarray(0, newline).toString("utf8");
      pending = pending.subarray(newline + 1);
      onLine(line);
      newline = pending.indexOf(0x0a);
    }
  });
}

function lastCarriage(line) {
  const parts = line.split("\r");
  return parts[parts.length - 1] ?? "";
}

function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
}

function charWidth(codePoint) {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

function clipAnsi(text, columns) {
  let width = 0;
  let out = "";
  for (let index = 0; index < text.length;) {
    if (text[index] === "\x1b") {
      const match = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/.exec(
        text.slice(index),
      );
      if (match && match.index === 0) {
        out += match[0];
        index += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(index);
    const size = codePoint > 0xffff ? 2 : 1;
    const next = width + charWidth(codePoint);
    if (next > columns) break;
    out += text.slice(index, index + size);
    width = next;
    index += size;
  }
  return out;
}

function descendantPids(pid) {
  const pids = [];
  const pending = [pid];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    let output = "";
    try {
      output = execFileSync("pgrep", ["-P", String(current)], { encoding: "utf8" });
    } catch {
      continue;
    }
    for (const line of output.split("\n")) {
      const childPid = Number(line);
      if (!childPid) continue;
      pids.push(childPid);
      pending.push(childPid);
    }
  }
  return pids;
}

function signalTree(child, signal) {
  if (!child.pid) return;
  const pids = [...descendantPids(child.pid), child.pid];
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // すでに終了している
    }
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // プロセスグループが既に無い
    }
  }
}

function stop(child) {
  signalTree(child, "SIGTERM");
}

function forceKill(child) {
  signalTree(child, "SIGKILL");
}
