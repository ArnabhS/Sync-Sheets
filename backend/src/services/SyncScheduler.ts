import { SyncConfig } from '../types/sync';
import { SyncEngine, SyncEvent } from './SyncEngine';

export type SyncSchedulerDeps = {
  getConfigs: () => Promise<SyncConfig[]>;
  runSync: (config: SyncConfig) => Promise<SyncEvent | null>;
  onEvent?: (event: SyncEvent) => void;
};

/**
 * Polling-based scheduler: runs sync for each active config at a fixed interval.
 * Optimized for multiplayer: short interval captures concurrent sheet edits.
 */
export class SyncScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private pollIntervalMs: number;

  constructor(
    private deps: SyncSchedulerDeps,
    pollIntervalSec: number = 10
  ) {
    this.pollIntervalMs = Math.max(2000, pollIntervalSec * 1000);
  }

  start(): void {
    if (this.intervalId) return;
    this.isRunning = true;
    const tick = async () => {
      if (!this.isRunning) return;
      try {
        const configs = (await this.deps.getConfigs()).filter((c) => c.active);
        configs.forEach((config) => {
          this.deps.runSync(config).then((event) => {
            if (event) this.deps.onEvent?.(event);
          }).catch(() => {});
        });
      } catch {
        // ignore
      }
    };
    tick();
    this.intervalId = setInterval(() => tick(), this.pollIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async triggerNow(configId: string): Promise<SyncEvent | null> {
    const configs = await this.deps.getConfigs();
    const config = configs.find((c) => c.id === configId);
    if (!config) return null;
    return this.deps.runSync(config);
  }
}
