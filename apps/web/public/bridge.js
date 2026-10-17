/*
 * MF100 校正システム — Web サイト用ブリッジ（docs/FIGMA_WEB_PROOFING.md WB-04・§6.2）。
 *
 * 委員会が管理するサイトに次の 1 行を置くと、校正システムの中（iframe）で開いたときだけ動き、
 * ページの要素を指してコメントできるようになる。校正システムの外で開いたときは何もしない。
 *
 *   <script src="https://<校正システムのオリジン>/bridge.js" data-allow-origin="https://<校正システムのオリジン>" defer></script>
 *
 * あわせてサイト側の応答ヘッダーに `Content-Security-Policy: frame-ancestors 'self' https://<校正システムのオリジン>` が要る
 * （X-Frame-Options: DENY / SAMEORIGIN があれば外す）。
 *
 * 安全のための決まり:
 * - 親（校正システム）とのやり取りは postMessage だけ。相手のオリジンは data-allow-origin（省けば同じオリジン）に限る。
 *   許していないオリジンからのメッセージは無視し、送るときも targetOrigin を指定する（"*" は使わない）
 * - サイトの内容を外へ送るのは、押した要素のセレクタ・タグ・短い引用文（200 文字まで）・矩形だけ。フォームの値や Cookie は送らない
 * - 依存ライブラリ無し。ページの DOM は書き換えない（枠のハイライト用の要素を 1 つ足すだけ）
 *
 * 親 → 子: {source:"mf100-host", type:"mode", mode:"browse"|"comment"} / {type:"resolve", anchors:[{id, selector, fallback}]} /
 *          {type:"scrollTo", id | selector, fallback} / {type:"highlight", id|null}
 * 子 → 親: {source:"mf100-bridge", type:"ready", url, title, viewport, scroll, docHeight} /
 *          {type:"hit", url, selector, elementRect, rect?|point?, page, viewport} /
 *          {type:"rects", items:[{id, candidates:[{by, rect, text}]}], scroll, viewport} / {type:"navigate", url}
 */
(function () {
  "use strict";
  if (window.parent === window) return; // 校正システムの中で開いたときだけ
  var script = document.currentScript;
  var allowAttr = script && script.getAttribute("data-allow-origin");
  var allowed = (allowAttr ? allowAttr.split(/\s+/) : [location.origin]).filter(Boolean);
  var hostOrigin = null; // 最初に正しいメッセージをくれた親に固定する
  var mode = "browse";
  var anchors = []; // 親から頼まれた再アンカーの対象
  var QUOTE_MAX = 200;
  var V = 1;

  function send(msg) {
    msg.source = "mf100-bridge";
    msg.v = V;
    var targets = hostOrigin ? [hostOrigin] : allowed;
    for (var i = 0; i < targets.length; i++) {
      try {
        window.parent.postMessage(msg, targets[i]);
      } catch {
        /* 送れないオリジンは無視 */
      }
    }
  }
  function viewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };
  }
  function scroll() {
    return { x: window.scrollX || 0, y: window.scrollY || 0 };
  }
  function here() {
    return location.pathname + location.search;
  }
  function docHeight() {
    var b = document.body,
      d = document.documentElement;
    return Math.max(b ? b.scrollHeight : 0, d ? d.scrollHeight : 0);
  }
  function pageRect(el) {
    var r = el.getBoundingClientRect();
    var s = scroll();
    return { x: r.left + s.x, y: r.top + s.y, w: r.width, h: r.height };
  }
  function textOf(el) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
  }

  // ---- セレクタの生成（id → 経路の nth-of-type。途中で一意になれば打ち切る）
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function unique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }
  function cssPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      if (node.id && !/^\d/.test(node.id) && !/\d{4,}/.test(node.id)) {
        var byId = "#" + cssEscape(node.id);
        if (unique(byId)) {
          parts.unshift(byId);
          return parts.join(" > ");
        }
      }
      var seg = tag;
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (same.length > 1) seg += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(seg);
      if (tag === "body") break;
      var joined = parts.join(" > ");
      if (parts.length >= 2 && unique(joined)) return joined;
      node = parent;
    }
    return parts.join(" > ");
  }
  function xpathOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var tag = node.tagName.toLowerCase();
      var idx = 1;
      var sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(tag + "[" + idx + "]");
      node = node.parentElement;
    }
    return "/" + parts.join("/");
  }
  function byXPath(xp) {
    try {
      var r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue && r.singleNodeValue.nodeType === 1 ? r.singleNodeValue : null;
    } catch {
      return null;
    }
  }
  // 引用文で探す: 同じタグの要素のうち、文字を含む最も小さいもの
  function byText(tag, exact) {
    if (!exact) return null;
    var want = exact.replace(/\s+/g, "").toLowerCase();
    var list = document.getElementsByTagName(tag || "*");
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var t = (el.textContent || "").replace(/\s+/g, "").toLowerCase();
      if (t.indexOf(want) < 0) continue;
      if (!best || t.length < (best.textContent || "").replace(/\s+/g, "").length) best = el;
    }
    return best;
  }
  function candidatesFor(a) {
    var out = [];
    var sel = a.selector || {};
    var el = null;
    try {
      el = sel.css ? document.querySelector(sel.css) : null;
    } catch {
      el = null;
    }
    if (el) out.push({ by: "css", rect: pageRect(el), text: textOf(el) });
    var xel = sel.xpath ? byXPath(sel.xpath) : null;
    if (xel && xel !== el) out.push({ by: "xpath", rect: pageRect(xel), text: textOf(xel) });
    var q = sel.textQuote && sel.textQuote.exact;
    if (q) {
      var tel = byText(sel.tag, q);
      if (tel && tel !== el && tel !== xel)
        out.push({ by: "text", rect: pageRect(tel), text: textOf(tel) });
    }
    return out;
  }
  var rectsQueued = false;
  function sendRects() {
    rectsQueued = false;
    if (!hostOrigin) return;
    var items = [];
    for (var i = 0; i < anchors.length; i++)
      items.push({ id: anchors[i].id, candidates: candidatesFor(anchors[i]) });
    send({
      type: "rects",
      items: items,
      scroll: scroll(),
      viewport: viewport(),
      url: here(),
      docHeight: docHeight(),
    });
  }
  function queueRects() {
    if (rectsQueued) return;
    rectsQueued = true;
    requestAnimationFrame(sendRects);
  }

  // ---- コメントモードの操作（押す・なぞる・文字を選ぶ）
  var box = null; // ホバーの枠
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #1b5fb4;border-radius:4px;" +
      "background:rgba(27,95,180,.08);box-shadow:0 0 0 2px rgba(255,255,255,.8);transition:all .08s;display:none;";
    var tag = document.createElement("span");
    tag.style.cssText =
      "position:absolute;left:-2px;top:-22px;font:11px/16px system-ui,sans-serif;padding:1px 6px;border-radius:4px;" +
      "background:#1b5fb4;color:#fff;white-space:nowrap";
    box.appendChild(tag);
    document.documentElement.appendChild(box);
    return box;
  }
  function showBox(el, label) {
    var b = ensureBox();
    if (!el) {
      b.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    b.style.display = "block";
    b.style.left = r.left + "px";
    b.style.top = r.top + "px";
    b.style.width = r.width + "px";
    b.style.height = r.height + "px";
    b.firstChild.textContent = label || el.tagName.toLowerCase();
  }
  var press = null;
  function targetAt(e) {
    var el = e.target;
    while (el && el.nodeType !== 1) el = el.parentNode;
    if (!el || el === box || (box && box.contains(el))) return null;
    if (el === document.documentElement) el = document.body;
    return el;
  }
  function onMove(e) {
    if (mode !== "comment") return;
    if (press) {
      var r = pageRect(press.el);
      var s = scroll();
      var x0 = Math.min(press.x, e.pageX),
        y0 = Math.min(press.y, e.pageY);
      var x1 = Math.max(press.x, e.pageX),
        y1 = Math.max(press.y, e.pageY);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        press.moved = true;
        var b = ensureBox();
        b.style.display = "block";
        b.style.left = Math.max(x0, r.x) - s.x + "px";
        b.style.top = Math.max(y0, r.y) - s.y + "px";
        b.style.width = Math.min(x1, r.x + r.w) - Math.max(x0, r.x) + "px";
        b.style.height = Math.min(y1, r.y + r.h) - Math.max(y0, r.y) + "px";
        b.firstChild.textContent = "範囲";
      }
      return;
    }
    showBox(targetAt(e));
  }
  function onDown(e) {
    if (mode !== "comment" || e.button !== 0) return;
    var el = targetAt(e);
    if (!el) return;
    press = { el: el, x: e.pageX, y: e.pageY, moved: false };
  }
  function selectionQuote(el) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var exact = range.toString().replace(/\s+/g, " ").trim();
    if (!exact) return null;
    var common = range.commonAncestorContainer;
    while (common && common.nodeType !== 1) common = common.parentNode;
    var container = common || el;
    var all = (container.textContent || "").replace(/\s+/g, " ");
    var at = all.indexOf(exact);
    var r = range.getBoundingClientRect();
    var s = scroll();
    return {
      element: container,
      quote: {
        exact: exact.slice(0, QUOTE_MAX),
        prefix: at > 0 ? all.slice(Math.max(0, at - 30), at) : undefined,
        suffix: at >= 0 ? all.slice(at + exact.length, at + exact.length + 30) : undefined,
      },
      rect: { x: r.left + s.x, y: r.top + s.y, w: r.width, h: r.height },
    };
  }
  function onUp(e) {
    if (mode !== "comment" || !press) return;
    var p = press;
    press = null;
    var el = p.el;
    var hit = {
      type: "hit",
      url: here(),
      viewport: viewport(),
      page: { pageX: e.pageX, pageY: e.pageY, scrollY: scroll().y },
    };
    var quoteInfo = selectionQuote(el);
    var elRect;
    if (quoteInfo) {
      el = quoteInfo.element;
      elRect = pageRect(el);
      hit.rect = relative(elRect, quoteInfo.rect);
    } else {
      elRect = pageRect(el);
      if (p.moved) {
        var x0 = Math.max(Math.min(p.x, e.pageX), elRect.x),
          y0 = Math.max(Math.min(p.y, e.pageY), elRect.y);
        var x1 = Math.min(Math.max(p.x, e.pageX), elRect.x + elRect.w),
          y1 = Math.min(Math.max(p.y, e.pageY), elRect.y + elRect.h);
        hit.rect = relative(elRect, {
          x: x0,
          y: y0,
          w: Math.max(0, x1 - x0),
          h: Math.max(0, y1 - y0),
        });
      } else {
        hit.point = {
          x: elRect.w > 0 ? Math.min(Math.max((e.pageX - elRect.x) / elRect.w, 0), 1) : 0.5,
          y: elRect.h > 0 ? Math.min(Math.max((e.pageY - elRect.y) / elRect.h, 0), 1) : 0.5,
        };
      }
    }
    hit.selector = {
      css: cssPath(el),
      xpath: xpathOf(el),
      tag: el.tagName.toLowerCase(),
      textQuote: quoteInfo ? quoteInfo.quote : undefined,
    };
    hit.elementRect = elRect;
    hit.text = textOf(el);
    showBox(null);
    if (window.getSelection) window.getSelection().removeAllRanges();
    send(hit);
  }
  function relative(elRect, r) {
    if (elRect.w <= 0 || elRect.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: (r.x - elRect.x) / elRect.w,
      y: (r.y - elRect.y) / elRect.h,
      w: r.w / elRect.w,
      h: r.h / elRect.h,
    };
  }
  // コメントモードではリンクやボタンの既定の動き（ページ移動・送信）を止める
  function swallow(e) {
    if (mode !== "comment") return;
    e.preventDefault();
    e.stopPropagation();
  }
  function setMode(next) {
    mode = next === "comment" ? "comment" : "browse";
    document.documentElement.style.cursor = mode === "comment" ? "crosshair" : "";
    if (mode !== "comment") {
      press = null;
      showBox(null);
    }
  }
  function scrollToAnchor(msg) {
    var a = msg.id
      ? anchors.filter(function (x) {
          return x.id === msg.id;
        })[0]
      : msg;
    if (!a) return;
    var c = candidatesFor(a);
    if (c.length) {
      var r = c[0].rect;
      window.scrollTo({
        left: Math.max(0, r.x - 16),
        top: Math.max(0, r.y - window.innerHeight / 3),
        behavior: "smooth",
      });
    } else if (a.fallback) {
      window.scrollTo({
        top: Math.max(0, a.fallback.pageY - window.innerHeight / 3),
        behavior: "smooth",
      });
    }
    queueRects();
  }
  var hiTimer = null;
  function highlight(id) {
    if (hiTimer) clearTimeout(hiTimer);
    var a = id
      ? anchors.filter(function (x) {
          return x.id === id;
        })[0]
      : null;
    var c = a ? candidatesFor(a) : [];
    if (!c.length) {
      showBox(null);
      return;
    }
    var r = c[0].rect;
    var s = scroll();
    var b = ensureBox();
    b.style.display = "block";
    b.style.left = r.x - s.x + "px";
    b.style.top = r.y - s.y + "px";
    b.style.width = r.w + "px";
    b.style.height = r.h + "px";
    b.firstChild.textContent = "コメントの位置";
    hiTimer = setTimeout(function () {
      if (mode !== "comment") showBox(null);
    }, 1600);
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.source !== "mf100-host") return;
    if (allowed.indexOf(e.origin) < 0) return; // 許していないオリジンは無視
    if (!hostOrigin) hostOrigin = e.origin;
    else if (hostOrigin !== e.origin) return;
    if (d.type === "mode") setMode(d.mode);
    else if (d.type === "resolve") {
      anchors = Array.isArray(d.anchors) ? d.anchors.slice(0, 500) : [];
      queueRects();
    } else if (d.type === "scrollTo") scrollToAnchor(d);
    else if (d.type === "highlight") highlight(d.id);
  });
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("click", swallow, true);
  document.addEventListener("submit", swallow, true);
  window.addEventListener("scroll", queueRects, { passive: true });
  window.addEventListener("resize", queueRects);
  window.addEventListener("hashchange", function () {
    send({ type: "navigate", url: here() });
    queueRects();
  });
  window.addEventListener("popstate", function () {
    send({ type: "navigate", url: here() });
    queueRects();
  });
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () {
      if (anchors.length) queueRects();
    });
    var start = function () {
      if (document.body)
        mo.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }
  function ready() {
    send({
      type: "ready",
      url: here(),
      title: document.title,
      viewport: viewport(),
      scroll: scroll(),
      docHeight: docHeight(),
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  // 画像やフォントで高さが変わったあとも親に知らせる
  window.addEventListener("load", function () {
    ready();
    queueRects();
  });
})();
