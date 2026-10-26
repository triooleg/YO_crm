type InvoiceNumber = { number: string; documentOptions?: unknown };

/** Customer document number is frozen with the document; SQL number stays a unique registry key. */
export function invoiceDisplayNumber(invoice: InvoiceNumber): string {
  const options = invoice.documentOptions;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const value = options as Record<string, unknown>;
    if (value.immutable === true && value.numberSource === "ORDER" &&
        typeof value.displayNumber === "string" && value.displayNumber.trim() && value.displayNumber.length <= 100) {
      return value.displayNumber;
    }
  }
  return invoice.number;
}

export function presentInvoice<T extends InvoiceNumber>(invoice: T): T {
  return { ...invoice, number: invoiceDisplayNumber(invoice) };
}
