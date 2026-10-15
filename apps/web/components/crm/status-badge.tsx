import { Badge } from "@mantine/core";
import { crmStatusUi } from "../../lib/i18n";
import { orderLabel, orderLabels } from "../../lib/orders-i18n";

export type StatusDomain = Exclude<keyof typeof orderLabels, "source">;
export type StatusTone = "danger" | "warning" | "success" | "info" | "violet";

type StatusToneMap = {
  [Domain in StatusDomain]: {
    [Status in keyof (typeof orderLabels)[Domain]]: StatusTone;
  };
};

const STATUS_TONES = {
  sales: {
    NEW_LEAD: "info",
    WAITING_CLIENT_REPLY: "violet",
    NEEDS_ESTIMATE: "violet",
    ESTIMATE_SENT: "violet",
    DESIGN_DISCUSSION: "violet",
    WAITING_COACH_APPROVAL: "violet",
    WAITING_DEPOSIT: "warning",
    DEPOSIT_RECEIVED: "violet",
    ORDER_CONFIRMED: "violet",
    MEASUREMENTS_REQUIRED: "warning",
    MEASUREMENTS_RECEIVED: "violet",
    READY_FOR_PRODUCTION: "violet",
    IN_PRODUCTION: "violet",
    FINAL_DECORATION: "violet",
    QUALITY_CONTROL: "violet",
    PHOTO_SENT: "violet",
    WAITING_FINAL_PAYMENT: "warning",
    PAID: "success",
    READY_TO_SHIP: "success",
    SHIPPED: "success",
    DELIVERED: "success",
    REVIEW_REQUESTED: "violet",
    COMPLETED: "success",
    CANCELLED: "danger",
  },
  production: {
    NOT_SCHEDULED: "info",
    TENTATIVE: "violet",
    SCHEDULED: "violet",
    MATERIALS: "violet",
    CUTTING: "violet",
    SEWING: "violet",
    DECORATION: "violet",
    QUALITY_CONTROL: "violet",
    READY: "success",
    ON_HOLD: "warning",
    CANCELLED: "danger",
  },
  payment: {
    UNPAID: "violet",
    PARTIALLY_PAID: "violet",
    DEPOSIT_PAID: "violet",
    PAID: "success",
    REFUNDED: "violet",
    CANCELLED: "danger",
  },
  shipping: {
    NOT_READY: "violet",
    READY: "success",
    LABEL_CREATED: "violet",
    SHIPPED: "success",
    IN_TRANSIT: "violet",
    DELIVERED: "success",
    RETURNED: "danger",
    LOST: "danger",
  },
} satisfies StatusToneMap;

const TONE_COLORS: Record<StatusTone, string> = {
  danger: "red",
  warning: "yellow",
  success: "green",
  info: "cyan",
  violet: "yoleotard",
};

export function CrmStatusBadge({
  domain,
  status,
  className,
  label,
}: {
  domain: StatusDomain;
  status: string;
  className?: string;
  label?: string;
}) {
  const presentation = crmStatusPresentation(domain,status);

  return (
    <Badge
      component="span"
      className={["crm-status-badge", `crm-status-badge--${presentation.tone}`, className]
        .filter(Boolean)
        .join(" ")}
      color={presentation.color}
      data-domain={domain}
      data-status={status}
      radius="xl"
      size="sm"
      variant="light"
    >
      {label ?? presentation.label}
    </Badge>
  );
}

export function crmStatusPresentation(domain: StatusDomain,status: string) {
  const tone = (STATUS_TONES[domain] as Record<string, StatusTone>)[status];
  return {
    label: tone ? orderLabel(domain,status) : crmStatusUi.unknown,
    tone: tone ?? "violet",
    color: TONE_COLORS[tone ?? "violet"],
  };
}
