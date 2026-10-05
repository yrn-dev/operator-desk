import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { presentTool } from "../src/toolPresentation.ts";
import { ToolInspector } from "../src/components/ToolInspector.tsx";
import type { ToolRun } from "../src/types.ts";

function run(name: string, args: Record<string, unknown>, output: string): ToolRun {
  return { kind: "tool", id: "test", name, args, output, done: true, failed: false };
}

const time = presentTool(run("time__get_current_time", { timezone: "Asia/Qyzylorda" },
  '{"timezone":"Asia/Qyzylorda","datetime":"2026-10-03T17:21:56+05:00","day_of_week":"Saturday","is_dst":false}'));
assert.equal(time.title, "Узнал текущее время");
assert.equal(time.resultKind, "time");
assert.match(time.primary ?? "", /17:21/);
assert.ok(!time.parameters.some((item) => item.value === "Asia/Qyzylorda"));

const folders = presentTool(run("filesystem__list_allowed_directories", {},
  "Allowed directories:\n/home/yernur"));
assert.equal(folders.resultKind, "list");
assert.deepEqual(folders.items, ["/home/yernur"]);

const search = presentTool(run("web_search", { query: "Operator" },
  '{"results":[{"title":"Operator Desktop","url":"https://example.com/operator"}]}'));
assert.equal(search.title, "Выполнил поиск");
assert.equal(search.resultKind, "list");
assert.deepEqual(search.items, ["Operator Desktop"]);

const balance = presentTool(run("higgsfield__balance", {}, '{"credits":0,"plan":"free"}'));
assert.equal(balance.resultKind, "fields");
assert.deepEqual(balance.fields?.map((field) => field.label), ["Кредиты", "Тариф"]);

const nested = presentTool(run("plugin__get_profile", {}, '{"data":{"name":"Yernur","login":"yrn-dev"}}'));
assert.equal(nested.resultKind, "fields");
assert.ok(nested.fields?.some((field) => field.value === "Yernur"));

const custom = presentTool(run("media__create_image", { prompt: "sunset" }, '{"status":"done","url":"https://example.com/image.png"}'));
assert.equal(custom.title, "Создал изображение");
assert.equal(custom.resultKind, "fields");

const nestedResult = presentTool(run("plugin__inspect", {}, '{"metadata":{"owner":"Yernur","count":2}}'));
assert.equal(nestedResult.resultKind, "fields");
assert.ok(nestedResult.fields?.some((field) => field.value === "Yernur"));

const written = run("write", { path: "src/new.ts", content: "export const answer = 42;" }, "");
assert.equal(presentTool(written).resultKind, "file");
const writtenHtml = renderToStaticMarkup(React.createElement(ToolInspector, { run: written, revision: 0, onClose: () => {} }));
assert.ok(writtenHtml.includes("export const answer = 42;"));
assert.ok(!writtenHtml.includes("Технические данные вызова"));

const failed = { ...written, failed: true, output: "Permission denied" };
const failedHtml = renderToStaticMarkup(React.createElement(ToolInspector, { run: failed, revision: 0, onClose: () => {} }));
assert.ok(failedHtml.includes("Permission denied"));
assert.ok(!failedHtml.includes("export const answer = 42;"));

const patched = run("patch", { path: "src/app.ts", patch: "@@ -1 +1 @@\n-const x = 1;\n+const x = 2;" }, "");
const patchedHtml = renderToStaticMarkup(React.createElement(ToolInspector, { run: patched, revision: 0, onClose: () => {} }));
assert.ok(patchedHtml.includes("diff-add") && patchedHtml.includes("diff-del"));

console.log("Tool presentations: time, filesystem, web search, balance, profile, file write, patch and failure");
