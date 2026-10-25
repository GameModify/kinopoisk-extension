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
  const frames = [];
  const timers = [];
  const events = {};
  const menus = new Map();
  const managerStyles = [];
  let observed;
  const mutations = [];
  const root = element("body");
  const html = element("html");
  html.append(root);
  if (options.existingHeader) root.append(element("header"));

  function element(tag) {
    return {
      tag,
      children: [],
      events: {},
      isConnected: false,
      attributes: new Map(),
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
      addEventListener(name, handler) {
        this.events[name] = handler;
      },
    };
  }

  const window = {
    location: { href },
    setInterval(handler) {
      timers.push(handler);
    },
    addEventListener(name, handler) {
      events[name] = handler;
    },
  };
  const document = {
    documentElement: options.documentReady === false ? null : html,
    body: options.documentReady === false ? null : root,
    createElement: element,
    getElementById: (id) => root.children.find((child) => child.id === id),
  };
  const context = {
    URL,
    window,
    document,
    requestAnimationFrame: (handler) => frames.push(handler),
    MutationObserver: class {
      constructor(handler) {
        mutations.push(handler);
      }
      observe(target) {
        observed = target;
      }
    },
    GM_registerMenuCommand(name, callback) {
      menus.set(name, callback);
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
    menus,
    managerStyles,
    observed: () => observed,
    document,
    ready() {
      document.documentElement = html;
      document.body = root;
      this.mutate();
    },
    tick() {
      for (const handler of timers) handler();
    },
    mutate() {
      for (const mutation of mutations) mutation();
      for (const handler of frames.splice(0)) handler();
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
  assert.match(insertion.attributes.textContent, /position: relative/);
});

test("document-start waits for the root and still registers its diagnostic menu", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/", {
    documentReady: false,
  });
  assert.equal(page.link(), undefined);
  assert.equal(page.observed(), page.document);
  assert.ok(page.menus.has("Показать кнопку Kinokino (1.1.0)"));
  page.ready();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
});

test("critical button styles survive an unsuccessful manager style insertion", () => {
  const page = browser("https://www.kinopoisk.ru/series/160958/", {
    styleInsertionFails: true,
  });
  assert.deepEqual(page.root.children[0].style.properties.get("position"), {
    value: "relative",
    priority: "important",
  });
  assert.equal(page.link().style.properties.get("background").value, "#2c2c2c");
});

test("the neutral tools panel precedes an existing header inside body", () => {
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
  page.menus.get("Показать кнопку Kinokino (1.1.0)")();
  assert.equal(page.link().href, "https://kinokino.vip/series/160958/");
  assert.equal(page.root.firstElementChild.scrolledIntoView, true);
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
  link.events.click(event);
  assert.equal(link.href, "https://kinokino.vip/film/666/?a=1#x");
  assert.equal(prevented, false);
  page.window.location.href = "https://www.kinopoisk.ru/";
  link.events.auxclick(event);
  assert.equal(prevented, true);
  assert.equal(page.link(), undefined);
});
