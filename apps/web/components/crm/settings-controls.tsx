import { ActionIcon, Button, Checkbox, NativeSelect, Textarea, TextInput, useMantineTheme } from "@mantine/core";
import type { ActionIconProps, ButtonProps, CheckboxProps, NativeSelectProps, TextareaProps, TextInputProps } from "@mantine/core";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type CrmButtonProps = ButtonProps &
  Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "form" | "name" | "onClick" | "title" | "type" | "value"> & {
  children?: ReactNode;
  className?: string;
  tone?: "primary" | "secondary";
};

type CrmActionIconProps = ActionIconProps &
  Pick<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "disabled" | "onClick" | "title" | "type"> & {
  children?: ReactNode;
  className?: string;
};

type CrmControlTheme = {
  controlHeight: number;
  horizontalPadding: number;
  buttonFontWeight: number;
  fieldLabelMarginBottom: number;
  fieldLabelColor: string;
  fieldLabelFontWeight: number;
  fieldBorderColor: string;
  highlightedFieldBackground: string;
  editableTextColor: string;
  fieldDescriptionMarginTop: number;
  fieldDescriptionColor: string;
  fieldDescriptionLineHeight: number;
};

function useCrmControlTheme() {
  return useMantineTheme().other.crmControls as CrmControlTheme;
}

function crmInputStyles(
  controls: CrmControlTheme,
  minHeight = controls.controlHeight,
  highlighted = false,
) {
  return {
    label: {
      marginBottom: controls.fieldLabelMarginBottom,
      color: controls.fieldLabelColor,
      fontWeight: controls.fieldLabelFontWeight,
    },
    input: {
      minHeight,
      borderColor: controls.fieldBorderColor,
      ...(highlighted ? { backgroundColor: controls.highlightedFieldBackground } : {}),
    },
    description: {
      marginTop: controls.fieldDescriptionMarginTop,
      color: controls.fieldDescriptionColor,
      lineHeight: controls.fieldDescriptionLineHeight,
    },
  };
}

export const CrmButton = forwardRef<HTMLButtonElement, CrmButtonProps>(function CrmButton(
  { className, tone = "primary", ...props },
  ref,
) {
  const controls = useCrmControlTheme();
  return (
    <Button
      ref={ref}
      className={["crm-button", `crm-button--${tone}`, className].filter(Boolean).join(" ")}
      variant={tone === "secondary" ? "default" : "filled"}
      mih={controls.controlHeight}
      px={controls.horizontalPadding}
      radius="md"
      fw={controls.buttonFontWeight}
      {...props}
    />
  );
});

export const CrmActionIcon = forwardRef<HTMLButtonElement, CrmActionIconProps>(function CrmActionIcon(
  { className, ...props },
  ref,
) {
  const controls = useCrmControlTheme();
  return (
    <ActionIcon
      ref={ref}
      className={["crm-action-icon", className].filter(Boolean).join(" ")}
      variant="subtle"
      radius="md"
      size={controls.controlHeight}
      {...props}
    />
  );
});

export function CrmCheckbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label className={["crm-checkbox", className].filter(Boolean).join(" ")}>
      <Checkbox value="on" {...props} />
      {label}
    </label>
  );
}

export const CrmTextInput = forwardRef<HTMLInputElement, TextInputProps & { highlighted?: boolean }>(function CrmTextInput(
  { className, highlighted, ...props },
  ref,
) {
  const controls = useCrmControlTheme();
  return (
    <TextInput
      ref={ref}
      className={["crm-text-input", className].filter(Boolean).join(" ")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      styles={crmInputStyles(controls, controls.controlHeight, highlighted)}
      {...props}
    />
  );
});

export const CrmTextarea = forwardRef<HTMLTextAreaElement, TextareaProps & { highlighted?: boolean }>(function CrmTextarea(
  { className, highlighted, ...props },
  ref,
) {
  const controls = useCrmControlTheme();
  return (
    <Textarea
      ref={ref}
      className={["crm-textarea", className].filter(Boolean).join(" ")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      styles={crmInputStyles(controls, 80, highlighted)}
      {...props}
    />
  );
});

export const CrmNativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function CrmNativeSelect(
  { className, ...props },
  ref,
) {
  const controls = useCrmControlTheme();
  return (
    <NativeSelect
      ref={ref}
      className={["crm-native-select", className].filter(Boolean).join(" ")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      styles={crmInputStyles(controls)}
      {...props}
    />
  );
});
