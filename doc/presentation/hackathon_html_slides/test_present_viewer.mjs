import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "index.html に実行スクリプトが必要です");

const handlers = {};
const frame = { src: "" };
const stage = {
  addEventListener(type, handler) {
    handlers[`stage:${type}`] = handler;
  },
};
const status = { innerHTML: "" };
const documentStub = {
  getElementById(id) {
    return { slideFrame: frame, stage, status }[id];
  },
  addEventListener(type, handler) {
    handlers[`document:${type}`] = handler;
  },
};
const windowStub = {
  location: { hash: "" },
  addEventListener(type, handler) {
    handlers[`window:${type}`] = handler;
  },
};
const historyStub = {
  replaceState(_state, _title, hash) {
    windowStub.location.hash = hash;
  },
};

vm.runInNewContext(script, {
  document: documentStub,
  window: windowStub,
  history: historyStub,
  Number,
  Math,
});

const key = (value) => {
  let prevented = false;
  handlers["document:keydown"]({
    key: value,
    preventDefault() { prevented = true; },
  });
  return prevented;
};

assert.equal(frame.src, "cover.html");
assert.equal(status.innerHTML, "<strong>1</strong> / 9");
assert.equal(key(" "), true);
assert.equal(frame.src, "problem.html");
assert.equal(key("Enter"), true);
assert.equal(frame.src, "plans.html");
assert.equal(key("ArrowRight"), true);
assert.equal(frame.src, "planning.html");
handlers["stage:click"]();
assert.equal(frame.src, "prototype.html");
assert.equal(key("Backspace"), true);
assert.equal(frame.src, "planning.html");
assert.equal(key("ArrowLeft"), true);
assert.equal(frame.src, "plans.html");
assert.equal(key("ArrowLeft"), true);
assert.equal(frame.src, "problem.html");
assert.equal(key("ArrowLeft"), true);
assert.equal(frame.src, "cover.html");
assert.equal(key("ArrowLeft"), true);
assert.equal(frame.src, "cover.html");
windowStub.location.hash = "#9";
handlers["window:hashchange"]();
assert.equal(frame.src, "closing.html");
assert.equal(status.innerHTML, "<strong>9</strong> / 9");

console.log("index.html navigation checks passed");
