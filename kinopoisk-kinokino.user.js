// ==UserScript==
// @name         Кинопоиск → Kinokino — Смотреть бесплатно
// @namespace    https://github.com/GameModify/kinopoisk-extension
// @version      1.2.0
// @description  Закреплённая кнопка слева на страницах фильмов и сериалов: открыть адрес на kinokino.vip.
// @match        https://www.kinopoisk.ru/*
// @match        https://kinopoisk.ru/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const HOST_ID = "kp-title-tools";
  const RUNTIME_KEY = "__kpTitleToolsRuntime";
  const STYLE = `
    :host {
      all: initial !important;
      position: fixed !important;
      left: 16px !important;
      bottom: 24px !important;
      top: auto !important;
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
      box-shadow: 0 3px 12px rgba(0, 0, 0, .18);
      -webkit-tap-highlight-color: transparent;
    }
    a::before { content: "▶"; font-size: 11px; }
    a:hover { background: #3b3b3b; border-color: #929292; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    a:active { background: #222; }
    @media (max-width: 700px) {
      :host { left: 12px !important; bottom: 16px !important; }
    }
  `;

  let host;
  let link;
  let frame = null;
  let timer;
  let hostObserver;

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
      left: "16px",
      bottom: "24px",
      top: "auto",
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
    link.title = "Открыть эту страницу на kinokino.vip";
    link.referrerPolicy = "no-referrer";
    addStyles(host.shadowRoot);
    // Re-read the URL at click time if navigation occurred between refreshes.
    link.onclick = update;
    link.onauxclick = update;
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
  }

  function scheduleUpdate() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  }

  function pause() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.clearInterval(timer);
  }

  function resume() {
    pause();
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
  }

  if (typeof window[RUNTIME_KEY] === "function") window[RUNTIME_KEY]();
  window[RUNTIME_KEY] = stop;
  GM_registerMenuCommand("Показать кнопку Kinokino (1.2.0)", resume, {
    id: HOST_ID,
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
  // pushState/replaceState do not emit popstate, including in userscript sandboxes.
  resume();
})();
