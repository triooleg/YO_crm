import test from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { loadTargetModule } from "./website-test-loader.mjs";

const { ClientMergePreviewDto, ClientMergeBatchDto } = loadTargetModule("clients/client-merge-workspace.dto.ts");

test("merge workspace DTO accepts 1..9 unique sources and only field-to-client choices", async () => {
  for (const size of [1, 9]) {
    assert.equal((await validate(plainToInstance(ClientMergePreviewDto, { sourceClientIds: Array.from({ length: size }, (_, i) => `source-${i}`), fieldChoices: { country: "source-0" } }))).length, 0);
  }
  for (const input of [
    { sourceClientIds: [] }, { sourceClientIds: ["a", "a"] }, { sourceClientIds: [42] },
    { sourceClientIds: Array.from({ length: 10 }, (_, i) => `s${i}`) },
    { sourceClientIds: ["a"], fieldChoices: [] }, { sourceClientIds: ["a"], fieldChoices: { archivedAt: "a" } },
    { sourceClientIds: ["a"], fieldChoices: { email: 7 } }, { sourceClientIds: ["a"], fieldChoices: null },
  ]) assert.ok((await validate(plainToInstance(ClientMergePreviewDto, input))).length > 0, JSON.stringify(input));
  assert.ok((await validate(plainToInstance(ClientMergeBatchDto, { sourceClientIds: ["a"] }))).length > 0);
  assert.equal((await validate(plainToInstance(ClientMergeBatchDto, { sourceClientIds: ["a"], previewToken: "a".repeat(64) }))).length, 0);
});
