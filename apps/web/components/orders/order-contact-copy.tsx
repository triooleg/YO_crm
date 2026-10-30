"use client";

import { ActionIcon, Tooltip, VisuallyHidden } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { orderContactCopyUi as ui } from "../../lib/i18n";

/** Copies a displayed order contact without activating its adjacent editor. */
export function OrderContactCopy({ value, label, identity }: { value?: string | null; label: string; identity?: string }) {
  if (!value?.trim()) return null;
  return <ContactCopyAction key={`${identity ?? ""}:${value}`} value={value} label={label} />;
}

function ContactCopyAction({ value, label }: { value: string; label: string }) {
  const clipboard = useClipboard({ timeout: 1800 });
  const feedback = clipboard.error ? ui.failed : clipboard.copied ? ui.copied : "";
  const title = feedback || `${ui.copy}: ${label}`;
  return <>
    <Tooltip label={title} withArrow>
      <ActionIcon type="button" className="orders-contact-copy" variant="subtle" size="md"
        color={clipboard.error ? "red" : clipboard.copied ? "green" : undefined}
        aria-label={title} onClick={event => { event.stopPropagation(); clipboard.reset(); clipboard.copy(value); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {clipboard.copied && !clipboard.error ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H4v13h4" /></>}
        </svg>
      </ActionIcon>
    </Tooltip>
    <VisuallyHidden role="status" aria-live="polite">{feedback}</VisuallyHidden>
  </>;
}
