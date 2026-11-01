import { ConflictException } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../secret-box';

/** Domain and record identity are authenticated alongside every encrypted evidence body. */
export type HistoryEvidenceKind = 'TARGET' | 'ORIGIN' | 'IDENTITY' | 'PILOT_SNAPSHOT' | 'NATIVE_WINDOW' | 'NATIVE_REVIEW' | 'OPERATIONAL_PREPARATION' | 'OPERATIONAL_CAPTURE';
export function sealHistoryEvidence(kind: HistoryEvidenceKind, key: string, content: unknown) {
  return encryptSecret(JSON.stringify({ version: 1, kind, key, content }));
}
export function openHistoryEvidence<T>(kind: HistoryEvidenceKind, key: string, ciphertext: string): T {
  try {
    const record = JSON.parse(decryptSecret(ciphertext));
    if (!record || Array.isArray(record) || Object.keys(record).sort().join(',') !== 'content,key,kind,version' ||
      record.version !== 1 || record.kind !== kind || record.key !== key || record.content === undefined) throw new Error();
    return record.content as T;
  } catch { throw new ConflictException('Нарушена привязка исторических доказательств'); }
}
