import { ConflictException } from '@nestjs/common';
import { encryptSecret, decryptSecret } from '../secret-box';
import type { MigrationBatch, MigrationJob } from './history-migration.repository';
import type { IntakePacket } from './intake-rules';
import { sha256 } from './intake-rules';

/** The GCM-authenticated plaintext binds even identical source bytes to their row. */
export function sealStagedPayload(job: MigrationJob, packet: IntakePacket) {
  return encryptSecret(JSON.stringify({ version: 1, jobId: job.id, batchId: packet.batchId, checksum: packet.checksum,
    source: job.source, account: job.account, channel: job.channel, payloadJson: packet.payloadJson }));
}
export function openStagedPayload(job: MigrationJob, batch: MigrationBatch): string {
  try {
    const r = JSON.parse(decryptSecret(batch.encryptedPayload));
    if (!r || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'account,batchId,channel,checksum,jobId,payloadJson,source,version' ||
      r.version !== 1 || r.jobId !== job.id || r.batchId !== batch.batchId || r.checksum !== batch.checksum ||
      r.source !== job.source || r.account !== job.account || r.channel !== job.channel ||
      typeof r.payloadJson !== 'string' || sha256(r.payloadJson) !== batch.checksum) throw new Error();
    return r.payloadJson;
  } catch { throw new ConflictException('Неверная привязка пакета или повреждено шифрование'); }
}
