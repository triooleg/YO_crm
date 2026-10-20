"use client";

import { ActionIcon } from "@mantine/core";
import { useRef, type MouseEvent } from "react";

type CrmSearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  clearLabel: string;
  className?: string;
  showSearchIcon?: boolean;
  autoFocus?: boolean;
};

export function CrmSearchField({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  clearLabel,
  className = "",
  showSearchIcon = false,
  autoFocus = false,
}: CrmSearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const classes = ["crm-search-field", className].filter(Boolean).join(" ");

  function clear() {
    onValueChange("");
    inputRef.current?.focus();
  }

  function focusFromContainer(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button,input")) return;
    event.preventDefault();
    inputRef.current?.focus();
  }

  return (
    <div className={classes} onMouseDown={focusFromContainer}>
      {showSearchIcon ? <span className="crm-search-leading-icon" aria-hidden="true">⌕</span> : null}
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
      />
      {value ? (
        <ActionIcon
          type="button"
          className="crm-search-clear"
          variant="subtle"
          color="gray"
          aria-label={clearLabel}
          title={clearLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m6 6 8 8m0-8-8 8" />
          </svg>
        </ActionIcon>
      ) : null}
    </div>
  );
}
