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
function browser(href) {
  const frames = [];
  const timers = [];
  const events = {};
  let mutation;
  const root = element("html");

  function element(tag) {
    return {
      tag,
      children: [],
      events: {},
      isConnected: false,
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
    documentElement: root,
    createElement: element,
    getElementById: (id) => root.children.find((child) => child.id === id),
  };
  vm.runInNewContext(source, {
    URL,
    window,
    document,
    requestAnimationFrame: (handler) => frames.push(handler),
    MutationObserver: class {
      constructor(handler) {
        mutation = handler;
      }
      observe() {}
    },
  });
  return {
    window,
    root,
    events,
    tick() {
      for (const handler of timers) handler();
    },
    mutate() {
      mutation();
      for (const handler of frames.splice(0)) handler();
    },
    link: () =>
      root.children[0]?.shadowRoot.children.find((child) => child.tag === "a"),
    rerun() {
      vm.runInNewContext(source, { URL, window, document });
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
