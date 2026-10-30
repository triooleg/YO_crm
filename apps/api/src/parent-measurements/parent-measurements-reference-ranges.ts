import type { RangeRule } from './parent-measurements-ranges.service';

/** Only the five visually transcribed columns; torso is the full circular ДУГА. */
export type ReferenceRow = Readonly<{
  heightCm: number; chestCm: number; waistCm: number; hipsCm: number; fullTorsoArcCm: number;
}>;

function rows(data: readonly (readonly [number, number, number, number, number])[]): readonly ReferenceRow[] {
  return Object.freeze(data.map(([heightCm, chestCm, waistCm, hipsCm, fullTorsoArcCm]) =>
    Object.freeze({ heightCm, chestCm, waistCm, hipsCm, fullTorsoArcCm })));
}

/** Original bytes are identified by SHA-256, with no filesystem access at runtime. */
export const PARENT_MEASUREMENTS_REFERENCE_SOURCES = Object.freeze([
  Object.freeze({
    filename: 'IMG_20210223_095236 (1).jpg',
    sha256: '21cb1513aff594536136b544bbbfe589c35954c9a44808f0c73cf592f2ef07e4',
    minHeightCm: 105, maxHeightCm: 172,
    rows: rows([
      [105, 56, 50, 59, 104], [110, 58, 51, 61, 107],
      [115, 60, 52, 63, 110], [120, 62, 53, 65, 113],
      [125, 64, 54, 68, 116], [130, 66, 55, 70, 119],
      [135, 68, 56, 72, 122], [140, 70, 58, 74, 125],
      [144, 72, 59, 76, 128], [148, 74, 61, 78, 131],
      [152, 76, 62, 81, 134], [156, 78, 64, 83, 137],
      [159, 80, 65, 85, 141], [162, 82, 67, 87, 145],
      [165, 84, 68, 89, 149], [168, 86, 70, 91, 153],
      [172, 88, 71, 93, 158],
    ]),
  }),
  Object.freeze({
    filename: '1708664899317.jpg',
    sha256: '3b94dee146198ea9aa58ca0d71739064fd3893696e0a2400abcf85c343c8d51a',
    minHeightCm: 95, maxHeightCm: 176,
    rows: rows([
      [95, 52, 48, 55, 96], [100, 54, 49, 57, 100],
      [105, 56, 51, 59, 104], [110, 58, 52, 61, 108],
      [115, 60, 53, 63, 111], [120, 62, 54, 65, 114],
      [125, 64, 55, 68, 117], [130, 66, 56, 70, 120],
      [135, 68, 57, 72, 123], [140, 70, 58, 74, 126],
      [144, 72, 60, 77, 129], [148, 74, 61, 79, 133],
      [152, 76, 62, 81, 136], [156, 78, 64, 84, 139],
      [159, 80, 65, 86, 142], [161, 82, 66, 88, 145],
      [164, 84, 67, 91, 148], [166, 86, 68, 94, 151],
      [168, 88, 69, 98, 154], [170, 90, 70, 100, 157],
      [172, 92, 72, 102, 160], [174, 94, 74, 104, 163],
      [176, 96, 76, 106, 167],
    ]),
  }),
]);

export const PARENT_MEASUREMENTS_REFERENCE_PACK = Object.freeze({
  id: 'gym-two-charts-v1',
  approvalDate: '2026-10-19',
  method: 'nearest-row-per-covered-source-min-max-plus-minus-3cm',
  marginCm: 3, heightStepCm: 0.5, minHeightCm: 95, maxHeightCm: 176,
  tie: 'lower-height',
  fields: Object.freeze([1, 2, 3, 15] as const),
  sources: PARENT_MEASUREMENTS_REFERENCE_SOURCES,
});

const columns = [
  [1, 'chestCm'], [2, 'waistCm'], [3, 'hipsCm'], [15, 'fullTorsoArcCm'],
] as const;

/**
 * Pure offline payload generator. Does not activate a policy or supply a fallback.
 * Inclusive intervals describe canonical half-cm heights only. No discipline/sex
 * is inferred: these are the explicitly approved two gymnastic charts only.
 */
export function generateParentMeasurementsReferenceRanges(): RangeRule[] {
  const result: RangeRule[] = [];
  for (const [field, column] of columns) {
    let previous: RangeRule | undefined;
    for (let tick = 190; tick <= 352; tick++) {
      const height = tick / 2;
      const values = PARENT_MEASUREMENTS_REFERENCE_SOURCES.flatMap(source => {
        if (height < source.minHeightCm || height > source.maxHeightCm) return [];
        // Rows ascend; strict comparison retains the lower row on equal distance.
        const nearest = source.rows.reduce((best, row) =>
          Math.abs(row.heightCm - height) < Math.abs(best.heightCm - height) ? row : best);
        return [nearest[column]];
      });
      const lowerCm = Math.min(...values) - 3;
      const upperCm = Math.max(...values) + 3;
      if (previous && previous.lowerCm === lowerCm && previous.upperCm === upperCm) {
        previous.maxHeightCm = height;
      } else {
        previous = { id: `g${field}_${tick}`, field, lowerCm, upperCm,
          minHeightCm: height, maxHeightCm: height };
        result.push(previous);
      }
    }
  }
  return result;
}
