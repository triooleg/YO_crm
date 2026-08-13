import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(
  new URL("../src/health.controller.ts", import.meta.url),
  "utf8",
);
const compose = await readFile(
  new URL("../../../docker-compose.yml", import.meta.url),
  "utf8",
);

test("health verifies every required production dependency", () => {
  assert.match(controller, /postgres/);
  assert.match(controller, /redis/);
  assert.match(controller, /uploads/);
  assert.match(controller, /REDIS_URL/);
  assert.match(controller, /uploadsRoot\(\)/);
  assert.match(controller, /randomUUID\(\)/);
  assert.match(controller, /flag:\s*"wx"/);
  assert.match(controller, /unlink/);
  assert.match(controller, /ServiceUnavailableException/);
});

test("local compose waits for Redis and uses the aggregate API healthcheck", () => {
  assert.match(compose, /redis:[\s\S]*?healthcheck:[\s\S]*?redis-cli[\s\S]*?ping/);
  assert.match(
    compose,
    /api:[\s\S]*?depends_on:[\s\S]*?redis:\s*\{\s*condition:\s*service_healthy\s*\}/,
  );
  assert.match(compose, /api:[\s\S]*?healthcheck:[\s\S]*?\/api\/health/);
});
