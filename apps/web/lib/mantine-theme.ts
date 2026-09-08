import { createTheme, type MantineColorsTuple } from "@mantine/core";

const yoleotardViolet: MantineColorsTuple = [
  "#f7f3ff",
  "#eee8ff",
  "#ded2ff",
  "#c9b6ff",
  "#ad92ff",
  "#916cff",
  "#6c4ad1",
  "#6334df",
  "#522bb8",
  "#432590",
];

export const yoleotardTheme = createTheme({
  primaryColor: "yoleotard",
  primaryShade: 6,
  colors: {
    yoleotard: yoleotardViolet,
  },
  fontFamily:
    'Ubuntu, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Tahoma, Arial, sans-serif',
  headings: {
    fontFamily:
      'Ubuntu, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Tahoma, Arial, sans-serif',
    fontWeight: "700",
  },
  fontSizes: {
    xs: "11px",
    sm: "12px",
    md: "14px",
    lg: "18px",
    xl: "22px",
  },
  spacing: {
    xs: "6px",
    sm: "8px",
    md: "12px",
    lg: "18px",
    xl: "24px",
  },
  radius: {
    xs: "6px",
    sm: "8px",
    md: "10px",
    lg: "13px",
    xl: "18px",
  },
  breakpoints: {
    xs: "30em",
    sm: "45em",
    md: "62.5em",
    lg: "75em",
    xl: "90em",
  },
  defaultRadius: "md",
  focusRing: "auto",
  cursorType: "pointer",
  respectReducedMotion: true,
});
