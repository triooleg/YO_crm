import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const controller = await readFile(new URL("../src/clients/clients.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/clients/clients.service.ts", import.meta.url), "utf8");

test("client routes require session and role guards", () => {
  assert.match(controller, /UseGuards\(SessionGuard, RolesGuard\)/);
  assert.match(controller, /@Roles\(UserRole\.OWNER, UserRole\.ADMIN, UserRole\.MANAGER\)/);
});

test("client, athlete and measurement creation append audit history", () => {
  assert.equal((service.match(/auditLog\.create/g) ?? []).length, 4);
  assert.equal((service.match(/activity\.create/g) ?? []).length, 4);
});

test("временный контакт из входящих оформляется без дублирования переписки",()=>{
  assert.match(controller,/promote-from-inbox/);
  assert.match(service,/status:"ACTIVE"/);
  assert.match(service,/CLIENT_PROMOTED_FROM_INBOX/);
  assert.match(service,/client-promote:/);
  assert.match(service,/source:before\.source/);
});

test("measurement creation verifies athlete belongs to client", () => {
  assert.match(service, /where: \{ id: athleteId, clientId, archivedAt: null \}/);
});
