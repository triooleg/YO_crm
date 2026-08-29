import { ForbiddenException, Injectable } from "@nestjs/common";

export type ToolRisk = "READ_ONLY" | "SAFE_WRITE" | "REQUIRES_APPROVAL" | "HIGH_RISK";
const TOOL_RISKS = {
  getCustomer: "READ_ONLY", getConversation: "READ_ONLY", getOrders: "READ_ONLY", getOrder: "READ_ONLY",
  getProductionStatus: "READ_ONLY", getPaymentStatus: "READ_ONLY", getShippingStatus: "READ_ONLY",
  createTask: "SAFE_WRITE", addCustomerNote: "SAFE_WRITE", addOrderNote: "SAFE_WRITE", addOrderRequirement: "SAFE_WRITE",
  changeDeadline: "REQUIRES_APPROVAL", changePrice: "REQUIRES_APPROVAL", markPaymentReceived: "REQUIRES_APPROVAL",
  sendMessage: "HIGH_RISK", refund: "HIGH_RISK", deleteOrder: "HIGH_RISK",
} as const satisfies Record<string, ToolRisk>;

@Injectable()
export class ToolService {
  risk(name: string): ToolRisk { return TOOL_RISKS[name as keyof typeof TOOL_RISKS] ?? "HIGH_RISK"; }
  assertAllowed(name: string, approved = false) {
    const risk = this.risk(name);
    if (risk === "HIGH_RISK" || (risk === "REQUIRES_APPROVAL" && !approved)) throw new ForbiddenException("AI-действие требует подтверждения сотрудника");
    return risk;
  }
  available() { return Object.entries(TOOL_RISKS).map(([name, risk]) => ({ name, risk })); }
}
