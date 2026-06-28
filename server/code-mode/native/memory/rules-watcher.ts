import fs from 'fs';
import { findProjectRulesPath, readProjectRules } from './agents-md-reader';

export interface RulesUpdate {
  changed: boolean;
  rules: string | null;
}

/**
 * Tracks AGENTS.md / CLAUDE.md mtime and returns content when the file changes.
 */
export class RulesWatcher {
  private lastMtime: number | null = null;
  private lastPath: string | null = null;

  constructor(private workspacePath: string) {}

  /** Prime watcher state without reporting a change (call after initial load). */
  async sync(): Promise<void> {
    const target = findProjectRulesPath(this.workspacePath);
    if (!target) {
      this.lastPath = null;
      this.lastMtime = null;
      return;
    }
    const stat = await fs.promises.stat(target);
    this.lastPath = target;
    this.lastMtime = stat.mtimeMs;
  }

  async checkForUpdate(): Promise<RulesUpdate> {
    const target = findProjectRulesPath(this.workspacePath);

    if (!target) {
      const hadFile = this.lastPath !== null;
      this.lastPath = null;
      this.lastMtime = null;
      return { changed: hadFile, rules: null };
    }

    const stat = await fs.promises.stat(target);
    if (this.lastPath === target && this.lastMtime === stat.mtimeMs) {
      return { changed: false, rules: null };
    }

    this.lastPath = target;
    this.lastMtime = stat.mtimeMs;
    const rules = await readProjectRules(this.workspacePath);
    return { changed: true, rules };
  }
}
