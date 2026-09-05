import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const [shell, css, config, rootPackage, compose, changelog, releaseWorkflow, i18n] = await Promise.all([
  readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-shell.css", import.meta.url), "utf8"),
  readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../docker-compose.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"),
  readFile(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8"),
]);

test("текущая версия CRM всегда видна внизу интерфейса", () => {
  assert.match(shell, /className="crm-version"/);
  assert.match(shell, /navigationUi\.version/);
  assert.match(css, /\.crm-version\{[^}]*position:fixed[^}]*bottom:8px/);
  assert.match(config, /NEXT_PUBLIC_CRM_VERSION/);
});

test("клик по версии открывает русский журнал сборок", () => {
  assert.match(shell, /setReleaseHistoryOpen\(true\)/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /releaseHistoryUi\.releases/);
  assert.match(shell, /event\.key==="Escape"/);
  assert.match(css, /\.crm-release-overlay/);
  assert.match(i18n, /releaseHistoryUi/);
  assert.match(i18n, /Журнал изменений/);
  assert.match(i18n, /Ранее аватары Facebook-клиентов импортировались/);
});

test("каждая сборка имеет журнал изменений и GitHub Release", () => {
  assert.match(changelog, /## \[0\.1\.6\]/);
  assert.match(changelog, /## \[0\.1\.5\]/);
  assert.match(changelog, /## \[0\.1\.4\]/);
  assert.match(changelog, /## \[0\.1\.2\]/);
  assert.match(changelog, /## \[0\.1\.1\]/);
  assert.match(changelog, /## \[0\.1\.0\]/);
  assert.match(changelog, /Facebook/);
  assert.match(releaseWorkflow, /crm-v\*/);
  assert.match(releaseWorkflow, /index\(\$0, heading\) == 1/);
  assert.match(releaseWorkflow, /gh release create/);
});

test("релизная версия едина для интерфейса и Docker-сборки", () => {
  assert.equal(JSON.parse(rootPackage).version, "0.1.6");
  assert.match(config, /\.\.\/\.\.\/package\.json/);
  assert.match(compose, /CRM_VERSION:/);
  assert.match(compose, /CRM_COMMIT:/);
});
