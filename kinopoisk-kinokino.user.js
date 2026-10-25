// ==UserScript==
// @name         Кинопоиск → Kinokino — Смотреть бесплатно
// @namespace    https://github.com/GameModify/kinopoisk-extension
// @version      1.3.1
// @license      MIT
// @description  Перетаскиваемая кнопка просмотра с сохранением положения на страницах Кинопоиска.
// @match        https://www.kinopoisk.ru/*
// @match        https://kinopoisk.ru/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

/*
MIT License

Copyright (c) 2026 GameModify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(() => {
  "use strict";

  const HOST_ID = "kp-title-tools";
  const RUNTIME_KEY = "__kpTitleToolsRuntime";
  const POSITION_KEY = "button-position";
  const STYLE = `
    :host {
      all: initial !important;
      position: fixed !important;
      left: var(--kp-left, 16px) !important;
      bottom: auto !important;
      top: var(--kp-top, 50%) !important;
      right: auto !important;
      z-index: 2147483646 !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      box-sizing: border-box !important;
      width: max-content !important;
      max-width: calc(100vw - 32px) !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color-scheme: dark !important;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      padding: 10px 14px;
      border: 1px solid #595959;
      border-radius: 10px;
      background: #2c2c2c;
      color: #f5f5f5;
      font: 600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-decoration: none;
      max-width: 100%;
      touch-action: none;
      user-select: none;
      cursor: grab;
      box-shadow: 0 3px 12px rgba(0, 0, 0, .18);
      -webkit-tap-highlight-color: transparent;
    }
    a::before { content: "▶"; font-size: 11px; }
    a:hover { --kp-bg: #3b3b3b; --kp-border: #929292; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    a:active { --kp-bg: #222; --kp-cursor: grabbing; }
  `;

  let host;
  let link;
  let frame = null;
  let timer = null;
  let refreshTimer = null;
  let hostObserver;
  let position = null;
  let drag = null;
  let suppressClick = false;
  let positionRefreshPending = true;
  let positionWritePending = false;
  let menusRegistered = false;
  const ruleStyle = document.createElement("span").style;
  const canonicalRules = new Map();

  function readPosition() {
    const value = GM_getValue(POSITION_KEY, null);
    if (!value || typeof value !== "object") return null;
    if (
      ![value.x, value.y].every(
        (number) => Number.isFinite(number) && number >= 0 && number <= 1,
      )
    )
      return null;
    return { x: value.x, y: value.y };
  }

  function bounds() {
    const { clientWidth: width, clientHeight: height } =
      document.documentElement;
    const rect = host.getBoundingClientRect();
    const margin = width <= 700 ? 12 : 16;
    return {
      min: margin,
      maxX: Math.max(margin, width - rect.width - margin),
      maxY: Math.max(margin, height - rect.height - margin),
    };
  }

  function moveTo(left, top) {
    const box = bounds();
    const x = Math.round(Math.min(box.maxX, Math.max(box.min, left)));
    const y = Math.round(Math.min(box.maxY, Math.max(box.min, top)));
    for (const [name, value] of [
      ["--kp-left", `${x}px`],
      ["--kp-top", `${y}px`],
    ]) {
      if (host.style.getPropertyValue(name) !== value)
        host.style.setProperty(name, value);
    }
  }

  function applyPosition() {
    if (!host?.isConnected || drag) return;
    const box = bounds();
    const target = position ?? { x: 0, y: 0.5 };
    moveTo(
      box.min + target.x * (box.maxX - box.min),
      box.min + target.y * (box.maxY - box.min),
    );
  }

  function savePosition() {
    const box = bounds();
    const rect = host.getBoundingClientRect();
    const ratio = (value, max) =>
      max === box.min
        ? 0
        : Math.min(1, Math.max(0, (value - box.min) / (max - box.min)));
    position = { x: ratio(rect.left, box.maxX), y: ratio(rect.top, box.maxY) };
    persistPosition(position);
  }

  function releaseDragPointer(pointerId) {
    if (link.hasPointerCapture(pointerId))
      link.releasePointerCapture(pointerId);
  }

  function cancelDrag(event) {
    if (!drag) return;
    if (event && event.pointerId !== drag.id) return;
    const pointerId = drag.id;
    suppressClick = drag.moved;
    drag = null;
    releaseDragPointer(pointerId);
    applyPosition();
  }

  function startDrag(event) {
    if (event.button !== 0 || event.isPrimary === false || drag) return;
    suppressClick = false;
    const rect = host.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    link.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    suppressClick = true;
    event.preventDefault();
    moveTo(drag.left + dx, drag.top + dy);
  }

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const completed = drag;
    drag = null;
    if (completed.moved) {
      event.preventDefault();
      savePosition();
    }
    releaseDragPointer(completed.id);
  }

  function activateLink(event) {
    if (suppressClick && event.button === 0 && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    suppressClick = false;
    update(event);
  }

  function resetPosition() {
    cancelDrag();
    persistPosition(null);
    applyPosition();
  }

  function setRules(element, rules, priority = "") {
    for (const [name, value] of Object.entries(rules)) {
      const key = `${name}:${value}`;
      if (!canonicalRules.has(key)) {
        ruleStyle.setProperty(name, value);
        canonicalRules.set(key, ruleStyle.getPropertyValue(name));
      }
      if (
        element.style.getPropertyValue(name) !== canonicalRules.get(key) ||
        element.style.getPropertyPriority(name) !== priority
      ) {
        element.style.setProperty(name, value, priority);
      }
    }
  }

  function restoreVisibility() {
    if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
    if (link.hasAttribute("hidden")) link.removeAttribute("hidden");
    // Critical appearance survives even if extension-owned style nodes disappear.
    const hostRules = {
      all: "initial",
      position: "fixed",
      left: "var(--kp-left, 16px)",
      bottom: "auto",
      top: "var(--kp-top, 50%)",
      right: "auto",
      margin: "0",
      padding: "0",
      border: "0",
      display: "block",
      visibility: "visible",
      opacity: "1",
      height: "auto",
      "max-height": "none",
      width: "max-content",
      "max-width": "calc(100vw - 32px)",
      "box-sizing": "border-box",
      overflow: "visible",
      "pointer-events": "auto",
      background: "transparent",
      "z-index": "2147483646",
    };
    const linkRules = {
      display: "inline-flex",
      "align-items": "center",
      gap: "8px",
      "box-sizing": "border-box",
      "max-width": "100%",
      visibility: "visible",
      opacity: "1",
      padding: "10px 14px",
      background: "var(--kp-bg, #2c2c2c)",
      color: "#f5f5f5",
      border: "1px solid var(--kp-border, #595959)",
      "border-radius": "10px",
      "text-decoration": "none",
      "touch-action": "none",
      "user-select": "none",
      cursor: "var(--kp-cursor, grab)",
      font: '600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    };
    setRules(host, hostRules, "important");
    setRules(link, linkRules);
  }

  function addStyles(shadow) {
    const existing = shadow.querySelector("style");
    if (existing?.textContent === STYLE) return;
    if (existing) existing.remove();
    // Tampermonkey's API can insert styles on CSP-restricted pages.
    try {
      GM_addElement(shadow, "style", { textContent: STYLE });
    } catch {
      // The manager can still be reconnecting after a history restoration.
    }
  }

  function destination(href) {
    const url = new URL(href);
    if (!["kinopoisk.ru", "www.kinopoisk.ru"].includes(url.hostname))
      return null;
    if (!/^\/(film|series)\/\d+(?:\/|$)/.test(url.pathname)) return null;
    return `https://kinokino.vip${url.pathname}${url.search}${url.hash}`;
  }

  function createButton() {
    // Reuse restored DOM, but attach fresh runtime handlers after history recovery.
    host = document.getElementById(HOST_ID);
    link = host?.shadowRoot?.querySelector("a");
    if (!link) {
      if (host) host.remove();
      host = document.createElement("kp-title-tools");
      host.id = HOST_ID;
      host.attachShadow({ mode: "open" });
      link = document.createElement("a");
      host.shadowRoot.append(link);
    }
    link.textContent = "Смотреть бесплатно";
    link.title =
      "Открыть на kinokino.vip. Зажмите и перетащите, чтобы переместить кнопку.";
    link.draggable = false;
    link.referrerPolicy = "no-referrer";
    // Re-read the URL at click time if navigation occurred between refreshes.
    link.onclick = activateLink;
    link.onauxclick = activateLink;
    link.onpointerdown = startDrag;
    link.onpointermove = moveDrag;
    link.onpointerup = finishDrag;
    link.onpointercancel = cancelDrag;
    link.onlostpointercapture = cancelDrag;
    link.ondragstart = (event) => event.preventDefault();
    link.oncontextmenu = (event) => {
      if (drag) event.preventDefault();
    };
    hostObserver = new MutationObserver(scheduleUpdate);
    hostObserver.observe(host, {
      attributes: true,
      attributeFilter: ["style", "hidden", "class"],
    });
    queueExtensionRefresh();
  }

  function update(event) {
    const href = destination(window.location.href);
    if (!href) {
      if (event) event.preventDefault();
      if (host) host.remove();
      return;
    }
    if (!document.body) return;
    if (!host) createButton();
    if (link.href !== href) link.href = href;
    if (document.body.firstElementChild !== host) document.body.prepend(host);
    restoreVisibility();
    applyPosition();
  }

  function scheduleUpdate() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }

  function pause() {
    cancelDrag();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    positionRefreshPending = true;
  }

  function resume() {
    pause();
    ensureWatchdog();
    update();
    queueExtensionRefresh();
    scheduleUpdate();
  }

  function ensureWatchdog() {
    if (timer === null) timer = window.setInterval(watchdog, 800);
  }

  function watchdog() {
    if (document.hidden) return;
    update();
    if (positionRefreshPending || !menusRegistered || needsStyles())
      queueExtensionRefresh();
  }

  function needsStyles() {
    return (
      host?.isConnected &&
      host.shadowRoot.querySelector("style")?.textContent !== STYLE
    );
  }

  function queueExtensionRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(refreshFromExtension, 0);
  }

  function persistPosition(value) {
    position = value;
    positionWritePending = true;
    try {
      GM_setValue(POSITION_KEY, value);
      positionWritePending = false;
    } catch {
      positionRefreshPending = true;
      queueExtensionRefresh();
    }
  }

  function refreshFromExtension() {
    refreshTimer = null;
    if (document.hidden) return;
    // Run after lifecycle dispatch: Tampermonkey reconnects its ports on pageshow.
    if (positionRefreshPending || positionWritePending) {
      try {
        if (positionWritePending) {
          GM_setValue(POSITION_KEY, position);
          positionWritePending = false;
        } else {
          position = readPosition();
        }
        positionRefreshPending = false;
      } catch {
        positionRefreshPending = true;
      }
    }
    registerMenus();
    if (needsStyles()) addStyles(host.shadowRoot);
    update();
  }

  function registerMenus() {
    if (menusRegistered) return;
    try {
      GM_registerMenuCommand("Показать кнопку Kinokino (1.3.1)", resume, {
        id: HOST_ID,
      });
      GM_registerMenuCommand("Сбросить положение кнопки", resetPosition, {
        id: `${HOST_ID}-reset`,
      });
      menusRegistered = true;
    } catch {
      // DOM repair does not depend on the extension's menu connection.
    }
  }

  function onVisibility() {
    if (!document.hidden) resume();
  }

  function onPageHide() {
    pause();
    menusRegistered = false;
  }

  function stop() {
    pause();
    window.clearInterval(timer);
    timer = null;
    documentObserver.disconnect();
    hostObserver?.disconnect();
    for (const name of ["popstate", "hashchange", "pageshow"])
      window.removeEventListener(name, resume, true);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pagehide", onPageHide, true);
    document.removeEventListener("visibilitychange", onVisibility, true);
    document.removeEventListener("resume", resume, true);
    window.removeEventListener("resize", onResize);
  }

  function onResize() {
    cancelDrag();
    applyPosition();
  }

  if (typeof window[RUNTIME_KEY] === "function") window[RUNTIME_KEY]();
  window[RUNTIME_KEY] = stop;
  const documentObserver = new MutationObserver(scheduleUpdate);
  documentObserver.observe(document, {
    childList: true,
    subtree: true,
  });
  for (const name of ["popstate", "hashchange", "pageshow"])
    window.addEventListener(name, resume, true);
  window.addEventListener("focus", resume);
  window.addEventListener("pagehide", onPageHide, true);
  document.addEventListener("visibilitychange", onVisibility, true);
  document.addEventListener("resume", resume, true);
  window.addEventListener("resize", onResize);
  // pushState/replaceState do not emit popstate, including in userscript sandboxes.
  resume();
})();
