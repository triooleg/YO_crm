import { Alert } from "@mantine/core";
import type { ReactNode } from "react";
import { crmAlertUi } from "../../lib/i18n";

export function CrmAlert({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <Alert
      className={["crm-alert", className].filter(Boolean).join(" ")}
      closeButtonLabel={crmAlertUi.close}
      color="red"
      onClose={onClose}
      radius="md"
      role="alert"
      aria-live="assertive"
      variant="light"
      withCloseButton={Boolean(onClose)}
    >
      {children}
    </Alert>
  );
}
