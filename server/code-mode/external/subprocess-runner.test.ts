import { describe, it, expect } from 'vitest';
import { parseCliJsonEvent } from './subprocess-runner';

describe('parseCliJsonEvent', () => {
  // ── Claude Code formats ──

  it('parses Claude assistant message as text_final (deduplication)', () => {
    const event = parseCliJsonEvent({
      type: 'assistant',
      message: {
        type: 'message',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });
    expect(event).toEqual({ type: 'text_final', data: { text: 'Hello world' } });
  });

  it('parses Claude result line as text_final (deduplication)', () => {
    const event = parseCliJsonEvent({
      type: 'result',
      result: 'Done.',
    });
    expect(event).toEqual({ type: 'text_final', data: { text: 'Done.' } });
  });

  it('parses nested Claude stream_event', () => {
    const event = parseCliJsonEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hi' },
      },
    });
    expect(event).toEqual({ type: 'text_delta', data: { text: 'Hi' } });
  });

  // ── Codex formats ──

  it('parses Codex item.completed agent_message as text_final (deduplication)', () => {
    const event = parseCliJsonEvent({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'Hello' },
    });
    expect(event).toEqual({ type: 'text_final', data: { text: 'Hello' } });
  });

  it('parses Codex flat item.agent_message', () => {
    const event = parseCliJsonEvent({
      type: 'item.agent_message',
      content: 'Flat message text',
    });
    expect(event).toEqual({ type: 'text_delta', data: { text: 'Flat message text' } });
  });

  it('parses Codex method-based item/agentMessage/delta', () => {
    const event = parseCliJsonEvent({
      method: 'item/agentMessage/delta',
      params: { delta: 'streaming token' },
    });
    expect(event).toEqual({ type: 'text_delta', data: { text: 'streaming token' } });
  });

  it('parses Codex method-based item/completed as text_final (deduplication)', () => {
    const event = parseCliJsonEvent({
      method: 'item/completed',
      params: { item: { type: 'agentMessage', text: 'Complete message' } },
    });
    expect(event).toEqual({ type: 'text_final', data: { text: 'Complete message' } });
  });

  it('maps Codex method turn/started to progress', () => {
    const event = parseCliJsonEvent({ method: 'turn/started', params: {} });
    expect(event).toEqual({ type: 'progress', data: { method: 'turn/started', params: {} } });
  });

  it('maps Codex method turn/completed to progress', () => {
    const event = parseCliJsonEvent({ method: 'turn/completed', params: {} });
    expect(event).toEqual({ type: 'progress', data: { method: 'turn/completed', params: {} } });
  });

  // ── Error handling ──

  it('parses top-level error event', () => {
    const event = parseCliJsonEvent({
      type: 'error',
      message: 'Fatal: connection refused',
    });
    expect(event).toEqual({ type: 'error', data: { message: 'Fatal: connection refused' } });
  });

  it('maps Codex reconnection error to progress', () => {
    const event = parseCliJsonEvent({
      type: 'error',
      message: 'Reconnecting... 1/5 (unexpected status 404)',
    });
    expect(event).toEqual({ type: 'progress', data: { type: 'error', message: 'Reconnecting... 1/5 (unexpected status 404)' } });
  });

  it('parses turn.failed event', () => {
    const event = parseCliJsonEvent({
      type: 'turn.failed',
      error: { message: 'Rate limited', code: 429 },
    });
    expect(event).toEqual({ type: 'error', data: { message: 'Rate limited' } });
  });

  // ── Session meta extraction ──

  it('extracts thread_id from Codex thread.started', () => {
    const event = parseCliJsonEvent({
      type: 'thread.started',
      thread_id: 'thread_abc123',
    });
    expect(event).toEqual({
      type: 'session_meta',
      data: { cliSessionId: 'thread_abc123', source: 'codex' },
    });
  });

  it('extracts session_id from Claude Code system init', () => {
    const event = parseCliJsonEvent({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-xyz',
      cwd: '/path/to/project',
    });
    expect(event).toEqual({
      type: 'session_meta',
      data: { cliSessionId: 'claude-session-xyz', source: 'claudecode' },
    });
  });

  // ── Progress / lifecycle passthrough ──

  it('maps generic lifecycle events to progress', () => {
    const cases = [
      { type: 'turn.started' },
      { type: 'turn.completed' },
      { type: 'response.created' },
      { type: 'response.completed' },
      { type: 'message_start' },
      { type: 'message_stop' },
    ];
    for (const obj of cases) {
      const event = parseCliJsonEvent(obj);
      expect(event?.type).toBe('progress');
    }
  });

  // ── Unknown events ──

  it('returns null for completely unknown events', () => {
    const event = parseCliJsonEvent({ type: 'unknown_custom_type', data: {} });
    expect(event).toBeNull();
  });
});

