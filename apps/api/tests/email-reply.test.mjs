import assert from "node:assert/strict";
import test from "node:test";
import { emailReplyHeaders, latestInboundEmailReplyLookup } from "../src/communications/email-reply.ts";

test("Gmail fallback still selects the latest inbound parent after more than 30 outbound messages", () => {
  const messages = [
    { id: "inbound", direction: "INBOUND", createdAt: 1, metadata: { messageId: "<inbound@gmail>", subject: "Order", references: ["<root@gmail>"] } },
    ...Array.from({ length: 31 }, (_, index) => ({ id: `outbound-${index}`, direction: "OUTBOUND", createdAt: index + 2, metadata: { messageId: `<outbound-${index}@gmail>` } })),
  ];
  const query = latestInboundEmailReplyLookup("conversation-1");
  const result = messages
    .filter((message) => message.direction === query.where.direction && typeof message.metadata.messageId === "string")
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  assert.equal(result?.id, "inbound");
  assert.deepEqual(emailReplyHeaders(result.metadata, "Client"), {
    subject: "Re: Order",
    parent: "<inbound@gmail>",
    references: ["<root@gmail>", "<inbound@gmail>"],
  });
});
