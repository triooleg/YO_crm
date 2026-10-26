import { invoiceWorkflowUi as ui } from "./i18n";

export function invoiceErrorMessage(reason: unknown, fallback: string = ui.error): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return message === "INVOICE_LOGO_UNAVAILABLE" ? ui.logoUnavailable : message || fallback;
}
