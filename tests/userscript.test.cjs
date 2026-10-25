const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  `${__dirname}/../kinopoisk-kinokino.user.js`,
  "utf8",
);

// Minimal DOM harness: execute the distributed userscript itself, including
// its navigation handlers, observer, timer and click-time URL refresh.
function browser(href, options = {}) {
  const storage = options.storage ?? new Map();
  const storageWrites = [];
  const frames = new Map();
  const timers = new Map();
  let nextId = 1;
  const events = {};
  const documentEvents = {};
  const menus = new Map();
  const managerStyles = [];
  let observed;
  const mutations = new Set();
  const root = element("body");
  const html = element("html");
  html.clientWidth = options.width ?? 1280;
  html.clientHeight = options.height ?? 720;
  html.append(root);
  if (options.existingHeader) root.append(element("header"));

  function element(tag) {
    return {
      tag,
      children: [],
      events: {},
      isConnected: false,
      attributes: new Map(),
      captured: new Set(),
      setPointerCapture(id) {
        this.captured.add(id);
      },
      hasPointerCapture(id) {
        return this.captured.has(id);
      },
      releasePointerCapture(id) {
        this.captured.delete(id);
        this.onlostpointercapture?.({ pointerId: id });
      },
      getBoundingClientRect() {
        const left =
          Number.parseFloat(this.style.getPropertyValue("--kp-left")) || 0;
        const top =
          Number.parseFloat(this.style.getPropertyValue("--kp-top")) || 0;
        const width = options.buttonWidth ?? 180;
        const height = options.buttonHeight ?? 40;
        return {
          left,
          top,
          width,
          height,
          right: left + width,
          bottom: top + height,
        };
      },
      style: {
        properties: new Map(),
        setProperty(name, value, priority) {
          this.properties.set(name, { value, priority });
        },
        getPropertyValue(name) {
          return this.properties.get(name)?.value ?? "";
        },
        getPropertyPriority(name) {
          return this.properties.get(name)?.priority ?? "";
        },
      },
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      removeAttribute(name) {
        this.attributes.delete(name);
      },
      hasAttribute(name) {
        return this.attributes.has(name);
      },
      get firstElementChild() {
        return this.children[0];
      },
      scrollIntoView() {
        this.scrolledIntoView = true;
      },
      prepend(child) {
        child.remove();
        child.parent = this;
        child.isConnected = true;
        this.children.unshift(child);
      },
      append(...children) {
        for (const child of children) {
          child.parent = this;
          child.isConnected = true;
          this.children.push(child);
        }
      },
      remove() {
        if (this.parent)
          this.parent.children = this.parent.children.filter((x) => x !== this);
        this.isConnected = false;
      },
      attachShadow() {
        this.shadowRoot = element("shadow");
        return this.shadowRoot;
      },
      querySelector(tag) {
        return this.children.find((child) => child.tag === tag) ?? null;
      },
      addEventListener(name, handler) {
        this.events[name] = handler;
      },
    };
  }

  const window = {
    location: { href },
    setInterval(handler) {
      const id = nextId++;
      timers.set(id, handler);
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    addEventListener(name, handler) {
      events[name] = handler;
    },
    removeEventListener(name, handler) {
      if (events[name] === handler) delete events[name];
    },
  };
  const document = {
    documentElement: options.documentReady === false ? null : html,
    body: options.documentReady === false ? null : root,
    createElement: element,
    getElementById: (id) => root.children.find((child) => child.id === id),
    addEventListener(name, handler) {
      documentEvents[name] = handler;
    },
    removeEventListener(name, handler) {
      if (documentEvents[name] === handler) delete documentEvents[name];
    },
  };
  const context = {
    URL,
    window,
    document,
    requestAnimationFrame(handler) {
      const id = nextId++;
      frames.set(id, handler);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    MutationObserver: class {
      constructor(handler) {
        this.handler = handler;
        mutations.add(handler);
      }
      observe(target) {
        observed = target;
      }
      disconnect() {
        mutations.delete(this.handler);
      }
    },
    GM_registerMenuCommand(name, callback) {
      menus.set(name, callback);
    },
    GM_getValue(key, fallback) {
      return storage.has(key) ? structuredClone(storage.get(key)) : fallback;
    },
    GM_setValue(key, value) {
      storage.set(key, structuredClone(value));
      storageWrites.push({ key, value: structuredClone(value) });
    },
    GM_addElement(parent, tag, attributes) {
      managerStyles.push({ parent, tag, attributes });
      if (options.styleInsertionFails) return null;
      const style = element(tag);
      Object.assign(style, attributes);
      parent.append(style);
      return style;
    },
  };
  vm.runInNewContext(source, context);
  return {
    window,
    root,
    events,
    documentEvents,
    menus,
    managerStyles,
    observed: () => observed,
    document,
    storage,
    storageWrites,
    resize(width, height) {
      html.clientWidth = width;
      html.clientHeight = height;
      events.resize();
    },
    pointer(type, x, y, extra = {}) {
      const event = {
        button: 0,
        pointerId: 1,
        isPrimary: true,
        clientX: x,
        clientY: y,
        detail: 1,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {},
        ...extra,
      };
      this.link()[`on${type}`](event);
      return event;
    },
    timerCount: () => timers.size,
    ready() {
      document.documentElement = html;
      document.body = root;
      this.mutate();
    },
    tick() {
      for (const handler of Array.from(timers.values())) handler();
    },
    mutate() {
      for (const mutation of mutations) mutation();
      const callbacks = Array.from(frames.values());
      frames.clear();
      for (const handler of callbacks) handler();
    },
    link: () =>
      root.children[0]?.shadowRoot.children.find((child) => child.tag === "a"),
    rerun() {
      vm.runInNewContext(source, context);
    },
  };
}

test("film and series links retain the complete path, query and fragment", () => {
  const cases = [
    [
      "https://www.kinopoisk.ru/series/160958/",
      "https://kinokino.vip/series/160958/",
    ],
    ["https://kinopoisk.ru/film/666", "https://kinokino.vip/film/666"],
    [
      "https://www.kinopoisk.ru/series/160958/episodes/?season=2#episode-3",
      "https://kinokino.vip/series/160958/episodes/?season=2#episode-3",
    ],
  ];
  for (const [input, expected] of cases) {
    const page = browser(input);
    assert.equal(page.link().href, expected);
    assert.equal(page.link().textContent, "Смотреть бесплатно");
    assert.equal(page.link().referrerPolicy, "no-referrer");
  }
});

test("userscript requests DOM isolation and CSP-aware styling", () => {
  assert.match(source, /^\/\/ @sandbox\s+DOM$/m);
  assert.match(source, /^\/\/ @grant\s+GM_addElement$/m);
  assert.doesNotMatch(source, /^\/\/ @grant\s+none$/m);
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  const insertion = page.managerStyles[0];
  assert.equal(insertion.tag, "style");
  assert.equal(insertion.parent, page.root.children[0].shadowRoot);
  assert.match(insertion.attributes.textContent, /position: fixed/);
});

test("document-start waits for the root and still registers its diagnostic menu", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/", {
    documentReady: false,
  });
  assert.equal(page.link(), undefined);
  assert.equal(page.observed(), page.document);
  assert.ok(page.menus.has("Показать кнопку Kinokino (1.3.0)"));
  page.ready();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
});

test("critical button styles survive an unsuccessful manager style insertion", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/", {
    styleInsertionFails: true,
  });
  assert.deepEqual(page.root.children[0].style.properties.get("position"), {
    value: "fixed",
    priority: "important",
  });
  assert.equal(page.link().style.properties.get("background").value, "#2c2c2c");
});

test("the neutral floating button stays inside body without replacing the header", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/", {
    existingHeader: true,
  });
  const host = page.root.firstElementChild;
  assert.equal(host.tag, "kp-title-tools");
  assert.equal(host.parent, page.document.body);
  assert.notEqual(host.parent, page.document.documentElement);
  assert.equal(host.hasAttribute("popover"), false);
  assert.equal(page.root.children[1].tag, "header");
});

test("cosmetic hiding and hidden attributes are repaired without repeated writes", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  const host = page.root.firstElementChild;
  host.style.setProperty("display", "none", "important");
  host.style.setProperty("opacity", "0", "important");
  host.setAttribute("hidden", "");
  page.mutate();
  assert.equal(host.style.getPropertyValue("display"), "block");
  assert.equal(host.style.getPropertyValue("opacity"), "1");
  assert.equal(host.hasAttribute("hidden"), false);
  let writes = 0;
  host.style.setProperty = () => {
    writes++;
  };
  page.tick();
  assert.equal(writes, 0);
});

test("the Tampermonkey menu restores a removed button", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  page.root.children[0].remove();
  page.menus.get("Показать кнопку Kinokino (1.3.0)")();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
  assert.equal(page.timerCount(), 1);
});

test("the initial position is on the left at the vertical midpoint without saving", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  const rect = page.root.firstElementChild.getBoundingClientRect();
  assert.equal(rect.left, 16);
  assert.equal(rect.top, 340);
  assert.equal(page.storageWrites.length, 0);
});

test("dragging saves the position once and blocks the following navigation click", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  page.pointer("pointerdown", 40, 355);
  page.pointer("pointermove", 440, 455);
  assert.equal(page.storageWrites.length, 0);
  page.tick();
  assert.equal(page.root.firstElementChild.getBoundingClientRect().left, 416);
  page.pointer("pointerup", 440, 455);
  assert.equal(page.storageWrites.length, 1);
  assert.equal(page.pointer("click", 440, 455).prevented, true);
  assert.equal(page.pointer("click", 440, 455, { detail: 0 }).prevented, false);
  const nextPage = browser("https://kinopoisk.ru/series/160958/", {
    storage: page.storage,
  });
  const rect = nextPage.root.firstElementChild.getBoundingClientRect();
  assert.equal(rect.left, 416);
  assert.equal(rect.top, 440);
});

test("small movements remain ordinary clicks and never save a position", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  page.pointer("pointerdown", 40, 355);
  page.pointer("pointermove", 42, 356);
  page.pointer("pointerup", 42, 356);
  assert.equal(page.pointer("click", 42, 356).prevented, false);
  assert.equal(page.storageWrites.length, 0);
});

test("touch dragging is bounded and restored inside a smaller viewport", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  page.pointer("pointerdown", 40, 355, { pointerType: "touch" });
  page.pointer("pointermove", 9000, 9000, { pointerType: "touch" });
  page.pointer("pointerup", 9000, 9000, { pointerType: "touch" });
  let rect = page.root.firstElementChild.getBoundingClientRect();
  assert.equal(rect.right, 1264);
  assert.equal(rect.bottom, 704);
  page.resize(390, 500);
  rect = page.root.firstElementChild.getBoundingClientRect();
  assert.equal(rect.left, 198);
  assert.equal(rect.top, 448);
  assert.equal(page.storageWrites.length, 1);
});

test("cancelled drags revert without saving; the menu resets a saved position", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  page.pointer("pointerdown", 40, 355);
  page.pointer("pointermove", 300, 300);
  page.pointer("pointercancel", 300, 300);
  assert.equal(page.root.firstElementChild.getBoundingClientRect().left, 16);
  assert.equal(page.storageWrites.length, 0);
  page.pointer("pointerdown", 40, 355);
  page.pointer("pointermove", 400, 300);
  page.pointer("pointerup", 400, 300);
  page.menus.get("Сбросить положение кнопки")();
  assert.equal(page.storage.get("button-position"), null);
  assert.equal(page.root.firstElementChild.getBoundingClientRect().top, 340);
});

test("invalid stored coordinates are ignored and right-click cannot start a drag", () => {
  const storage = new Map([["button-position", { x: -1, y: Number.NaN }]]);
  const page = browser("https://www.kinopoisk.ru/film/326/", { storage });
  assert.equal(page.root.firstElementChild.getBoundingClientRect().left, 16);
  page.pointer("pointerdown", 40, 355, { button: 2 });
  page.pointer("pointermove", 400, 400);
  page.pointer("pointerup", 400, 400);
  assert.equal(page.storageWrites.length, 0);
});

test("Back to a cached page reloads the position saved on another page", () => {
  const storage = new Map();
  const first = browser("https://www.kinopoisk.ru/film/326/", { storage });
  first.events.pagehide();
  const second = browser("https://www.kinopoisk.ru/series/160958/", {
    storage,
  });
  second.pointer("pointerdown", 40, 355);
  second.pointer("pointermove", 440, 455);
  second.pointer("pointerup", 440, 455);
  second.events.pagehide();
  first.events.pageshow({ persisted: true });
  const rect = first.root.firstElementChild.getBoundingClientRect();
  assert.equal(rect.left, 416);
  assert.equal(rect.top, 440);
  assert.equal(first.timerCount(), 1);
});

test("a secondary pointer cannot cancel the primary drag", () => {
  const page = browser("https://www.kinopoisk.ru/film/326/");
  page.pointer("pointerdown", 40, 355);
  page.pointer("pointermove", 440, 455);
  page.pointer("pointercancel", 0, 0, { pointerId: 2, isPrimary: false });
  page.pointer("lostpointercapture", 0, 0, { pointerId: 2, isPrimary: false });
  page.pointer("pointerup", 440, 455);
  assert.equal(page.storageWrites.length, 1);
  assert.equal(page.root.firstElementChild.getBoundingClientRect().left, 416);
});

test("unrelated routes and lookalike hostnames do not get a button", () => {
  for (const url of [
    "https://www.kinopoisk.ru/",
    "https://www.kinopoisk.ru/index.php?kp_query=test",
    "https://www.kinopoisk.ru/name/123/",
    "https://www.kinopoisk.ru/series/123abc/",
    "https://kinopoisk.ru.evil.example/film/123/",
    "https://hd.kinopoisk.ru/film/123/",
  ])
    assert.equal(browser(url).link(), undefined, url);
});

test("SPA navigation, back/forward and DOM removal keep exactly one current button", () => {
  const page = browser("https://www.kinopoisk.ru/");
  page.window.location.href = "https://www.kinopoisk.ru/series/160958/";
  page.tick();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
  page.window.location.href = "https://www.kinopoisk.ru/film/666/";
  page.mutate();
  assert.equal(page.link().href, "https://kinokino.vip/film/666/");
  page.root.children[0].remove();
  page.mutate();
  for (let n = 0; n < 10; n++) page.tick();
  assert.equal(page.root.children.length, 1);
  page.rerun();
  assert.equal(page.root.children.length, 1);
  page.window.location.href = "https://www.kinopoisk.ru/name/123/";
  page.events.popstate();
  assert.equal(page.link(), undefined);
  page.window.location.href = "https://www.kinopoisk.ru/series/160958/";
  page.events.popstate();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
});

test("click refreshes a stale link immediately and cancels it on an unrelated route", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  const link = page.link();
  let prevented = false;
  const event = {
    preventDefault() {
      prevented = true;
    },
  };
  page.window.location.href = "https://www.kinopoisk.ru/film/666/?a=1#x";
  link.onclick(event);
  assert.equal(link.href, "https://kinokino.vip/film/666/?a=1#x");
  assert.equal(prevented, false);
  page.window.location.href = "https://www.kinopoisk.ru/";
  link.onauxclick(event);
  assert.equal(prevented, true);
  assert.equal(page.link(), undefined);
});

test("history restoration repairs the button and restarts a single polling timer", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  const host = page.root.firstElementChild;
  page.events.pagehide();
  assert.equal(page.timerCount(), 0);
  host.remove();
  host.setAttribute("hidden", "");
  page.events.pageshow({ persisted: true });
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
  assert.equal(host.hasAttribute("hidden"), false);
  assert.equal(page.timerCount(), 1);
  page.events.pageshow({ persisted: true });
  page.events.focus();
  page.documentEvents.visibilitychange();
  assert.equal(page.timerCount(), 1);
});

test("reinjection adopts existing DOM and reattaches runtime after recovery", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/");
  const host = page.root.firstElementChild;
  page.window.__kpTitleToolsRuntime();
  delete page.window.__kpTitleToolsRuntime;
  assert.equal(page.events.pageshow, undefined);
  page.rerun();
  assert.equal(page.root.firstElementChild, host);
  assert.equal(typeof page.events.pageshow, "function");
  assert.equal(page.timerCount(), 1);
  host.remove();
  page.events.pageshow({ persisted: true });
  assert.equal(page.root.firstElementChild, host);
  page.rerun();
  page.tick();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.managerStyles.length, 1);
  assert.equal(page.timerCount(), 1);
});
