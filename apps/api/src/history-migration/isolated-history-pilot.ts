import { BackupService } from '../backups/backup.service';
import { HistoryMigrationRepository, type MigrationTransaction } from './history-migration.repository';
import { assertIsolatedHistoryDatabase } from './isolated-history-state';
import { HistoryMigrationTransactionEngine } from './history-transaction-engine';

/** Unregistered pilot. Its executor cannot accept a native PostgreSQL target,
 * environment override, supplied assertion or caller-selected guard.
 */
export class IsolatedHistoryMigrationPilot extends HistoryMigrationTransactionEngine {
  constructor(private readonly repository: HistoryMigrationRepository, backups: BackupService) { super(backups); }
  protected withJob<T>(jobId: string, action: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
    return this.repository.withJob(jobId, async tx => {
      await assertIsolatedHistoryDatabase(tx.db);
      return action(tx);
    });
  }
}
