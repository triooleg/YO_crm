"use client";
import { MantineProvider } from '@mantine/core';
import { parentMeasurementsTheme } from '../../lib/mantine-theme';

export function ParentMeasurementsProvider({children}:{children:React.ReactNode}){
 return <MantineProvider theme={parentMeasurementsTheme} forceColorScheme="light" cssVariablesSelector=".pm-root" cssVariablesResolver={theme=>({variables:{'--mantine-color-dimmed':theme.other.parentMeasurements.helperColor},light:{'--mantine-color-dimmed':theme.other.parentMeasurements.helperColor},dark:{}})}>{children}</MantineProvider>;
}
