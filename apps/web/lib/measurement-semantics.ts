export const PARENT_BODY_DEFINITION = 'PARENT_BODY_V1';

import { measurementSemanticUi } from './i18n';
export { measurementSemanticUi };

export function measurementDefinitionSupported(version?: string | null) {
  return version == null || version === PARENT_BODY_DEFINITION;
}
export function measurementSemanticLabel(number: number, legacyLabel: string, version?: string | null) {
  if (number !== 6 || version == null) return legacyLabel;
  return version === PARENT_BODY_DEFINITION ? measurementSemanticUi.bodySleeve : measurementSemanticUi.unknownSleeve;
}
export function measurementSemanticNote(version?: string | null) {
  return version == null ? undefined : version === PARENT_BODY_DEFINITION ? measurementSemanticUi.bodyNote : measurementSemanticUi.unknownNote;
}
export function measurementPresetForDefinition(preset: Record<string, number>, version?: string | null) {
  if (!measurementDefinitionSupported(version)) return {};
  return Object.fromEntries(Object.entries(preset).filter(([key]) => version == null || key !== 'm6'));
}
export function measurementComparableNumbers(version?: string | null) {
  if (!measurementDefinitionSupported(version)) return [];
  return [1,2,3,4,5,6,7,10,13,15,16].filter(number => version == null || number !== 6);
}
export function measurementCopyValues(values: Record<string, number>, sourceVersion?: string | null, targetVersion: string | null | undefined = sourceVersion) {
  if (!measurementDefinitionSupported(sourceVersion) || !measurementDefinitionSupported(targetVersion)) throw new Error(measurementSemanticUi.unknownNote);
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'm6' || sourceVersion === targetVersion || (sourceVersion == null && targetVersion == null)));
}
