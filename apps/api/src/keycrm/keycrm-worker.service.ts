import { recoveryIsolationEnabled } from "../recovery-safety";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { KeycrmService } from "./keycrm.service";

@Injectable()
export class KeycrmWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeycrmWorkerService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly leaseOwner = randomUUID();

  constructor(private readonly keycrm: KeycrmService) {}

  onModuleInit() { if (recoveryIsolationEnabled()) return;
    this.timer = setInterval(() => void this.tick(), 3_200);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() { if (recoveryIsolationEnabled()) return;
    if (this.busy) return;
    this.busy = true;
    try {
      const run = await this.keycrm.claimNextRun(this.leaseOwner);
      if (run) await this.keycrm.processStep(run.id, this.leaseOwner);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "KeyCRM sync step failed");
    } finally {
      this.busy = false;
    }
  }
}
