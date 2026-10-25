// ==UserScript==
// @name         Кинопоиск → Kinokino — Смотреть бесплатно
// @namespace    https://github.com/GameModify/kinopoisk-extension
// @version      1.1.0
// @description  Панель над шапкой фильма или сериала: открыть тот же адрес на kinokino.vip.
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
  const STYLE = `
    :host {
      all: initial !important;
      position: relative !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      box-sizing: border-box !important;
      width: 100% !important;
      padding: 10px 16px !important;
      background: #181818 !important;
      border-bottom: 1px solid #303030 !important;
      text-align: center !important;
      color-scheme: dark !important;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      padding: 9px 15px;
      border: 1px solid #626262;
      border-radius: 8px;
      background: #2c2c2c;
      color: #f5f5f5;
      font: 600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }
    a::before { content: "▶"; font-size: 11px; }
    a:hover { background: #3b3b3b; border-color: #929292; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    a:active { background: #222; }
    @media (max-width: 700px) {
      :host { padding: 8px 12px !important; }
      a { padding: 9px 14px; font-size: 13px; }
    }
  `;

  let host;
  let link;
  let pending = false;

  function restoreVisibility() {
    if (host.hasAttribute("hidden")) host.removeAttribute("hidden");
    const rules = {
      display: "block",
      visibility: "visible",
      opacity: "1",
      position: "relative",
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
      position: "relative",
      margin: "0",
      padding: "10px 16px",
      border: "0",
      display: "block",
      visibility: "visible",
      opacity: "1",
      "pointer-events": "auto",
      background: "#181818",
      "text-align": "center",
    };
    const linkRules = {
      display: "inline-block",
      padding: "9px 15px",
      background: "#2c2c2c",
      color: "#f5f5f5",
      border: "1px solid #626262",
      "border-radius": "8px",
      "text-decoration": "none",
      font: '600 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    };
    for (const [name, value] of Object.entries(hostRules))
      host.style.setProperty(name, value, "important");
    for (const [name, value] of Object.entries(linkRules))
      link.style.setProperty(name, value);
  }

  function addStyles(shadow) {
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
    // A normal-flow tools element inside body avoids generic html > div filters.
    host = document.createElement("kp-title-tools");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    link = document.createElement("a");
    link.textContent = "Смотреть бесплатно";
    link.title = "Открыть эту страницу на kinokino.vip";
    link.referrerPolicy = "no-referrer";
    shadow.append(link);
    addStyles(shadow);
    // Re-read the URL at click time if navigation occurred between refreshes.
    link.addEventListener("click", update);
    link.addEventListener("auxclick", update);
    new MutationObserver(scheduleUpdate).observe(host, {
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
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      update();
    });
  }

  GM_registerMenuCommand("Показать кнопку Kinokino (1.1.0)", () => {
    update();
    if (host?.isConnected)
      host.scrollIntoView({ block: "start", behavior: "instant" });
  });
  if (document.getElementById(HOST_ID)) return;
  update();
  new MutationObserver(scheduleUpdate).observe(document, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", update);
  window.addEventListener("hashchange", update);
  window.addEventListener("pageshow", update);
  // pushState/replaceState do not emit popstate, including in userscript sandboxes.
  window.setInterval(update, 800);
})();
