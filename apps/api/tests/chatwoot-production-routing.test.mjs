import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composeFiles = await Promise.all([
  readFile(new URL("../../../docker-compose.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../docker-compose.portainer.yml", import.meta.url), "utf8"),
]);
const envExample = await readFile(
  new URL("../../../.env.portainer.example", import.meta.url),
  "utf8",
);

test("production API resolves Chatwoot through the configurable LAN host", () => {
  for (const compose of composeFiles) {
    const apiSection = compose.slice(compose.indexOf("  api:"), compose.indexOf("  web:"));
    const postgresSection = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  redis:"));
    const redisSection = compose.slice(compose.indexOf("  redis:"), compose.indexOf("  api:"));
    const webSection = compose.slice(
      compose.indexOf("  web:"),
      compose.lastIndexOf("\nvolumes:"),
    );

    assert.ok(webSection.length > 0);

    assert.match(
      apiSection,
      /extra_hosts:[\s\S]*chatwoot\.yoleotard\.com:\$\{CHATWOOT_HOST_IP:-192\.168\.31\.219\}/,
    );
    assert.doesNotMatch(postgresSection, /extra_hosts|CHATWOOT_HOST_IP/);
    assert.doesNotMatch(redisSection, /extra_hosts|CHATWOOT_HOST_IP/);
    assert.doesNotMatch(webSection, /extra_hosts|CHATWOOT_HOST_IP/);
  }
  assert.match(envExample, /^CHATWOOT_HOST_IP=192\.168\.31\.219$/m);
});
