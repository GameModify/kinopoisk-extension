// ==UserScript==
// @name         Кинопоиск → Kinokino — Смотреть бесплатно
// @namespace    https://github.com/GameModify/kinopoisk-extension
// @version      1.3.0
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
    a:hover { background: #3b3b3b; border-color: #929292; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    a:active { background: #222; cursor: grabbing; }
  `;

  let host;
  let link;
  let frame = null;
  let timer;
  let hostObserver;
  let position = null;
  let drag = null;
  let suppressClick = false;

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
    GM_setValue(POSITION_KEY, position);
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
    position = null;
    GM_setValue(POSITION_KEY, null);
    applyPosition();
  }

  function restoreVisibility() {
    if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
    const rules = {
      display: "block",
      visibility: "visible",
      opacity: "1",
      position: "fixed",
      height: "auto",
      "max-height": "none",
      overflow: "visible",
      "pointer-events": "auto",
    };
    for (const [name, value] of Object.entries(rules)) {
      if (
        host.style.getPropertyValue(name) !== value ||
        host.style.getPropertyPriority(name) !== "important"
      ) {
        host.style.setProperty(name, value, "important");
      }
    }
  }

  function fallbackStyles() {
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
      "pointer-events": "auto",
      background: "transparent",
      "z-index": "2147483646",
    };
    const linkRules = {
      display: "inline-block",
      padding: "10px 14px",
      background: "#2c2c2c",
      color: "#f5f5f5",
      border: "1px solid #595959",
      "border-radius": "10px",
      "text-decoration": "none",
      "touch-action": "none",
      "user-select": "none",
      cursor: "grab",
      font: '600 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    };
    for (const [name, value] of Object.entries(hostRules))
      host.style.setProperty(name, value, "important");
    for (const [name, value] of Object.entries(linkRules))
      link.style.setProperty(name, value);
  }

  function addStyles(shadow) {
    const existing = shadow.querySelector("style");
    if (existing?.textContent === STYLE) return;
    if (existing) existing.remove();
    // Tampermonkey's API can insert styles on CSP-restricted pages.
    const style = GM_addElement(shadow, "style", { textContent: STYLE });
    if (!style) fallbackStyles();
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
    addStyles(host.shadowRoot);
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
    window.clearInterval(timer);
  }

  function resume() {
    pause();
    position = readPosition();
    update();
    timer = window.setInterval(update, 800);
    scheduleUpdate();
  }

  function onVisibility() {
    if (!document.hidden) resume();
  }

  function stop() {
    pause();
    documentObserver.disconnect();
    hostObserver?.disconnect();
    for (const name of ["popstate", "hashchange", "pageshow", "focus"])
      window.removeEventListener(name, resume);
    window.removeEventListener("pagehide", pause);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", onResize);
  }

  function onResize() {
    cancelDrag();
    applyPosition();
  }

  if (typeof window[RUNTIME_KEY] === "function") window[RUNTIME_KEY]();
  window[RUNTIME_KEY] = stop;
  GM_registerMenuCommand("Показать кнопку Kinokino (1.3.0)", resume, {
    id: HOST_ID,
  });
  GM_registerMenuCommand("Сбросить положение кнопки", resetPosition, {
    id: `${HOST_ID}-reset`,
  });
  const documentObserver = new MutationObserver(scheduleUpdate);
  documentObserver.observe(document, {
    childList: true,
    subtree: true,
  });
  for (const name of ["popstate", "hashchange", "pageshow", "focus"])
    window.addEventListener(name, resume);
  window.addEventListener("pagehide", pause);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  // pushState/replaceState do not emit popstate, including in userscript sandboxes.
  resume();
})();
