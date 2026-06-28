import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RulesWatcher } from './rules-watcher';
import { upsertProjectRulesMessage, projectRulesMarker } from './agents-md-reader';
import type { Message } from '../../../../shared/types';

describe('RulesWatcher', () => {
  const tempDir = path.join(process.cwd(), 'temp-rules-watcher-' + crypto.randomUUID());

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns no change when file is unchanged', async () => {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Rules v1');
    const watcher = new RulesWatcher(tempDir);
    await watcher.sync();
    const update = await watcher.checkForUpdate();
    expect(update.changed).toBe(false);
  });

  it('detects content change via mtime', async () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, '# Rules v1');
    const watcher = new RulesWatcher(tempDir);
    await watcher.sync();

    await new Promise((r) => setTimeout(r, 20));
    const past = Date.now() - 1000;
    fs.utimesSync(filePath, past / 1000, past / 1000);
    fs.writeFileSync(filePath, '# Rules v2');

    const update = await watcher.checkForUpdate();
    expect(update.changed).toBe(true);
    expect(update.rules).toContain('Rules v2');
  });

  it('detects file removal', async () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, '# Rules');
    const watcher = new RulesWatcher(tempDir);
    await watcher.sync();
    fs.unlinkSync(filePath);

    const update = await watcher.checkForUpdate();
    expect(update.changed).toBe(true);
    expect(update.rules).toBeNull();
  });
});

describe('upsertProjectRulesMessage', () => {
  it('inserts rules message after primary system prompt', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: 'You are Kavis', timestamp: 0 },
      { id: '2', role: 'user', content: 'hi', timestamp: 1 },
    ];
    const updated = upsertProjectRulesMessage(messages, 'Use tabs');
    expect(updated).toHaveLength(3);
    expect(updated[1].content).toContain(projectRulesMarker());
    expect(updated[1].content).toContain('Use tabs');
  });

  it('replaces existing rules message', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: `${projectRulesMarker()}\nold`, timestamp: 0 },
    ];
    const updated = upsertProjectRulesMessage(messages, 'new rules');
    expect(updated).toHaveLength(1);
    expect(updated[0].content).toContain('new rules');
    expect(updated[0].content).not.toContain('old');
  });

  it('removes rules message when rules is null', () => {
    const messages: Message[] = [
      { id: '1', role: 'system', content: `${projectRulesMarker()}\nrules`, timestamp: 0 },
      { id: '2', role: 'user', content: 'hi', timestamp: 1 },
    ];
    const updated = upsertProjectRulesMessage(messages, null);
    expect(updated).toHaveLength(1);
    expect(updated[0].role).toBe('user');
  });
});
