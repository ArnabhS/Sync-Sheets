import { SyncConfig, SyncState } from '../types/sync';
import { ConfigRepository } from './ConfigRepository';

/**
 * Sync configs persisted in MySQL via ConfigRepository; sync state kept in memory.
 */
export class ConfigStore {
  private states = new Map<string, SyncState>();

  constructor(private repository: ConfigRepository) {}

  async listConfigs(): Promise<SyncConfig[]> {
    return this.repository.findAll();
  }

  async getConfig(id: string): Promise<SyncConfig | undefined> {
    const c = await this.repository.findById(id);
    return c ?? undefined;
  }

  async setConfig(config: SyncConfig): Promise<void> {
    const toSave = { ...config, updatedAt: new Date().toISOString() };
    if (!toSave.createdAt) toSave.createdAt = new Date().toISOString();
    await this.repository.save(toSave);
  }

  async deleteConfig(id: string): Promise<boolean> {
    this.states.delete(id);
    return this.repository.delete(id);
  }

  getState(configId: string): SyncState | undefined {
    return this.states.get(configId);
  }

  setState(configId: string, state: Partial<SyncState>): void {
    const existing = this.states.get(configId) ?? { configId };
    this.states.set(configId, { ...existing, ...state });
  }
}
