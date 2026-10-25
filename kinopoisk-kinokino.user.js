// ==UserScript==
// @name         Кинопоиск → Kinokino — Смотреть бесплатно
// @namespace    https://github.com/GameModify/kinopoisk-extension
// @version      1.0.0
// @description  Кнопка слева на страницах фильмов и сериалов: открыть тот же адрес на kinokino.vip.
// @match        https://www.kinopoisk.ru/*
// @match        https://kinopoisk.ru/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'kinopoisk-kinokino-button';
  const STYLE = `
    :host {
      all: initial !important;
      position: fixed !important;
      left: 16px !important;
      top: 45% !important;
      z-index: 2147483646 !important;
      display: block !important;
      color-scheme: light !important;
    }
    a {
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      padding: 15px 19px;
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 16px;
      background: linear-gradient(115deg, #ff6500, #ed3800);
      color: #fff;
      font: 700 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-decoration: none;
      box-shadow: 0 6px 24px rgba(0,0,0,.24);
      transition: filter .15s, transform .15s;
      -webkit-tap-highlight-color: transparent;
    }
    a::before { content: "▶"; font-size: 16px; }
    a:hover { filter: brightness(1.1); transform: translateY(-2px); }
    a:focus-visible { outline: 3px solid #1677ff; outline-offset: 4px; }
    a:active { transform: translateY(0); }
    @media (max-width: 700px) {
      :host { top: auto !important; bottom: 24px !important; left: 12px !important; }
      a { padding: 12px 15px; font-size: 13px; }
    }
    @media (prefers-reduced-motion: reduce) { a { transition: none; } }
  `;

  let host;
  let link;
  let pending = false;

  function destination(href) {
    const url = new URL(href);
    if (!['kinopoisk.ru', 'www.kinopoisk.ru'].includes(url.hostname)) return null;
    if (!/^\/(film|series)\/\d+(?:\/|$)/.test(url.pathname)) return null;
    return `https://kinokino.vip${url.pathname}${url.search}${url.hash}`;
  }

  function createButton() {
    host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    link = document.createElement('a');
    link.textContent = 'Смотреть бесплатно';
    link.title = 'Открыть эту страницу на kinokino.vip';
    link.referrerPolicy = 'no-referrer';
    shadow.append(style, link);
    // Re-read the URL at click time if navigation occurred between refreshes.
    link.addEventListener('click', update);
    link.addEventListener('auxclick', update);
  }

  function update(event) {
    const href = destination(window.location.href);
    if (!href) {
      if (event) event.preventDefault();
      if (host) host.remove();
      return;
    }
    if (!host) createButton();
    if (link.href !== href) link.href = href;
    if (!host.isConnected) document.documentElement.append(host);
  }

  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      update();
    });
  }

  if (document.getElementById(HOST_ID)) return;
  update();
  new MutationObserver(scheduleUpdate).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('popstate', update);
  window.addEventListener('hashchange', update);
  window.addEventListener('pageshow', update);
  // pushState/replaceState do not emit popstate, including in userscript sandboxes.
  window.setInterval(update, 800);
})();
