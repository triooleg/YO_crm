import test from "node:test";
import assert from "node:assert/strict";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { RequestMethod } from "@nestjs/common";
import { loadTargetModule } from "./website-test-loader.mjs";

const { FinanceController } = loadTargetModule("finance/finance.controller.ts");
const { FinanceService } = loadTargetModule("finance/finance.service.ts");
const { SessionGuard } = loadTargetModule("auth/session.guard.ts");
const { RolesGuard } = loadTargetModule("auth/roles.guard.ts");

const issueDate = new Date("2026-11-06T00:00:00Z");
const order = { clientId: "client-a", archivedAt: null, client: { archivedAt: null }, number: "26-42" };
const draft = { id: "draft", number: "INV-42", issueDate, status: "DRAFT", archivedAt: null, order };
const saved = {
  ...draft, id: "saved", number: "registry-43",
  documentOptions: { immutable: true, numberSource: "ORDER", displayNumber: "26-43" },
  order: { ...order, number: "legacy", sourceSystem: "YOLEOTARD_WEBSITE", externalNumber: "WEB-43" },
};
const rows = [
  draft, saved,
  { ...saved, id: "foreign", order: { ...order, clientId: "client-b" } },
  { ...saved, id: "archived-client", order: { ...order, client: { archivedAt: issueDate } } },
  { ...saved, id: "archived-order", order: { ...order, archivedAt: issueDate } },
  { ...saved, id: "archived-invoice", archivedAt: issueDate },
  { ...saved, id: "cancelled", status: "CANCELLED" },
];
const pdf = Buffer.from("%PDF-1.7\nsaved snapshot bytes");
const scope = {
  archivedAt: null, status: { not: "CANCELLED" },
  order: { clientId: "client-a", archivedAt: null, client: { archivedAt: null } },
};

function fixture() {
  const reads = [];
  const eligible = row => row.archivedAt === null && row.status !== "CANCELLED" &&
    row.order.clientId === "client-a" && row.order.archivedAt === null && row.order.client.archivedAt === null;
  const db = {
    invoice: {
      async findMany({ where, take, orderBy }) {
        assert.deepEqual(where, scope);
        assert.equal(take, 100);
        assert.deepEqual(orderBy, [{ issueDate: "desc" }, { id: "desc" }]);
        return rows.filter(eligible).reverse();
      },
      async findFirst({ where: { id, ...where } }) {
        if (id === "archived-invoice" && !Object.keys(where).length) return rows.find(row => row.id === id);
        assert.deepEqual(where, scope);
        return rows.find(row => row.id === id && eligible(row)) ?? null;
      },
    },
    appSetting: {
      async findUnique({ where }) {
        assert.equal(where.section_key.section, "invoice-documents");
        reads.push(where.section_key.key);
        return { value: { pdfBase64: pdf.toString("base64") } };
      },
    },
  };
  const finance = new FinanceService(db);
  return { finance, controller: new FinanceController(finance), reads };
}

test("Inbox invoice routes are staff-only GETs and list saved drafts using display numbers", async () => {
  const { controller } = fixture();
  assert.equal(Reflect.getMetadata(PATH_METADATA, FinanceController), "finance");
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, FinanceController), [SessionGuard, RolesGuard]);
  for (const [handler, path] of [
    [controller.clientInvoices, "clients/:clientId/invoices"],
    [controller.clientInvoiceDocument, "clients/:clientId/invoices/:invoiceId/document"],
  ]) {
    assert.equal(typeof handler, "function");
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), path);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
    assert.deepEqual(Reflect.getMetadata("roles", handler), ["OWNER", "ADMIN", "MANAGER"]);
  }
  assert.deepEqual(await controller.clientInvoices("client-a"), [
    { id: "saved", number: "26-43", orderNumber: "WEB-43", issueDate },
    { id: "draft", number: "INV-42", orderNumber: "26-42", issueDate },
  ]);
});

test("Inbox invoice download scopes the snapshot read before returning private PDF bytes", async () => {
  const { finance, controller, reads } = fixture();
  const headers = new Map();
  const response = {
    setHeader: (key, value) => headers.set(key, value),
    send: body => body,
  };
  for (const id of ["foreign", "archived-client", "archived-order", "archived-invoice", "cancelled", "missing"]) {
    await assert.rejects(() => controller.clientInvoiceDocument("client-a", id, response), { status: 404 });
  }
  assert.deepEqual(reads, []);
  assert.equal(headers.size, 0);
  assert.deepEqual(await controller.clientInvoiceDocument("client-a", "saved", response), pdf);
  assert.deepEqual(reads, ["saved"]);
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("Content-Disposition"), 'attachment; filename="invoice-26-43.pdf"');
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.equal(headers.get("Content-Length"), String(pdf.length));
  assert.deepEqual((await finance.document("archived-invoice")).pdf, pdf);
});
