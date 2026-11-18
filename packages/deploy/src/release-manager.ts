import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReleaseRecord } from './types.js';

export class ReleaseManager {
  private readonly storagePath: string;
  private readonly maxHistory: number;
  private releases: ReleaseRecord[] = [];
  private loaded = false;

  constructor(storagePath?: string, maxHistory = 5) {
    this.storagePath = storagePath ?? path.join(process.cwd(), '.agent', 'releases.json');
    this.maxHistory = maxHistory;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await fs.readFile(this.storagePath, 'utf-8');
      this.releases = JSON.parse(content) as ReleaseRecord[];
    } catch {
      this.releases = [];
    }

    this.loaded = true;
  }

  private async save(): Promise<void> {
    const parentDir = path.dirname(this.storagePath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(this.releases, null, 2), 'utf-8');
  }

  /**
   * Records a newly deployed release, enforcing retention of the last N releases.
   */
  public async recordRelease(release: ReleaseRecord): Promise<void> {
    await this.load();

    // Mark previous active release in this environment as superseded
    for (const r of this.releases) {
      if (r.environment === release.environment && r.status === 'active') {
        r.status = 'rolled_back';
      }
    }

    // Prepend new active release (newest first)
    this.releases.unshift(release);

    // Keep only last N releases
    if (this.releases.length > this.maxHistory) {
      this.releases = this.releases.slice(0, this.maxHistory);
    }

    await this.save();
  }

  public async getActiveRelease(environment?: string): Promise<ReleaseRecord | undefined> {
    await this.load();
    return this.releases.find((r) => {
      const envMatch = environment ? r.environment === environment : true;
      return envMatch && r.status === 'active';
    });
  }

  /**
   * Finds the most recent previous release eligible for rollback.
   */
  public async getPreviousRelease(
    environment?: string,
    currentReleaseId?: string,
  ): Promise<ReleaseRecord | undefined> {
    await this.load();

    const candidates = this.releases.filter((r) => {
      const envMatch = environment ? r.environment === environment : true;
      const notCurrent = currentReleaseId ? r.releaseId !== currentReleaseId : true;
      return envMatch && notCurrent;
    });

    return candidates[0]; // Newest previous release
  }

  public async getRelease(releaseId: string): Promise<ReleaseRecord | undefined> {
    await this.load();
    return this.releases.find((r) => r.releaseId === releaseId);
  }

  public async listReleases(environment?: string): Promise<ReleaseRecord[]> {
    await this.load();
    if (environment) {
      return this.releases.filter((r) => r.environment === environment);
    }
    return [...this.releases];
  }

  /**
   * Updates status when a rollback occurs
   */
  public async markRolledBack(fromReleaseId: string, toReleaseId: string): Promise<void> {
    await this.load();

    const fromRel = this.releases.find((r) => r.releaseId === fromReleaseId);
    if (fromRel) {
      fromRel.status = 'rolled_back';
    }

    const toRel = this.releases.find((r) => r.releaseId === toReleaseId);
    if (toRel) {
      toRel.status = 'active';
    }

    await this.save();
  }
}
