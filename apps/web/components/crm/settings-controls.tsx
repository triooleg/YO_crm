import { Button, Checkbox, NativeSelect, TextInput, useMantineTheme } from "@mantine/core";
import type { ButtonProps, CheckboxProps, NativeSelectProps, TextInputProps } from "@mantine/core";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type CrmButtonProps = ButtonProps &
  Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "form" | "name" | "onClick" | "type" | "value"> & {
  children?: ReactNode;
  className?: string;
  tone?: "primary" | "secondary";
};

type CrmControlTheme = {
  controlHeight: number;
  horizontalPadding: number;
  buttonFontWeight: number;
  fieldLabelMarginBottom: number;
  fieldLabelColor: string;
  fieldLabelFontWeight: number;
  fieldBorderColor: string;
  fieldDescriptionMarginTop: number;
  fieldDescriptionColor: string;
  fieldDescriptionLineHeight: number;
};

function useCrmControlTheme() {
  return useMantineTheme().other.crmControls as CrmControlTheme;
}

export function CrmButton({ className, tone = "primary", ...props }: CrmButtonProps) {
  const controls = useCrmControlTheme();
  return (
    <Button
      className={["crm-button", `crm-button--${tone}`, className].filter(Boolean).join(" ")}
      variant={tone === "secondary" ? "default" : "filled"}
      mih={controls.controlHeight}
      px={controls.horizontalPadding}
      radius="md"
      fw={controls.buttonFontWeight}
      {...props}
    />
  );
}

export function CrmCheckbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label className={["crm-checkbox", className].filter(Boolean).join(" ")}>
      <Checkbox value="on" {...props} />
      {label}
    </label>
  );
}

export function CrmTextInput({ className, ...props }: TextInputProps) {
  const controls = useCrmControlTheme();
  return (
    <TextInput
      className={["crm-text-input", className].filter(Boolean).join(" ")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      styles={{
        label: {
          marginBottom: controls.fieldLabelMarginBottom,
          color: controls.fieldLabelColor,
          fontWeight: controls.fieldLabelFontWeight,
        },
        input: {
          minHeight: controls.controlHeight,
          borderColor: controls.fieldBorderColor,
        },
        description: {
          marginTop: controls.fieldDescriptionMarginTop,
          color: controls.fieldDescriptionColor,
          lineHeight: controls.fieldDescriptionLineHeight,
        },
      }}
      {...props}
    />
  );
}

export function CrmNativeSelect({ className, ...props }: NativeSelectProps) {
  const controls = useCrmControlTheme();
  return (
    <NativeSelect
      className={["crm-native-select", className].filter(Boolean).join(" ")}
      inputWrapperOrder={["label", "input", "description", "error"]}
      styles={{
        label: {
          marginBottom: controls.fieldLabelMarginBottom,
          color: controls.fieldLabelColor,
          fontWeight: controls.fieldLabelFontWeight,
        },
        input: {
          minHeight: controls.controlHeight,
          borderColor: controls.fieldBorderColor,
        },
        description: {
          marginTop: controls.fieldDescriptionMarginTop,
          color: controls.fieldDescriptionColor,
          lineHeight: controls.fieldDescriptionLineHeight,
        },
      }}
      {...props}
    />
  );
}
