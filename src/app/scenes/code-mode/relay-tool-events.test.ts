import { describe, it, expect } from 'vitest';
import { applyRelayToolEvent, parseRelayToolCall } from './relay-tool-events';

describe('relay-tool-events', () => {
  it('ignores unparseable tool_call payloads', () => {
    expect(parseRelayToolCall({ type: 'response.function_call_arguments.done' })).toBeNull();
  });

  it('parses OpenCode tool_call_start part shape', () => {
    const parsed = parseRelayToolCall({ name: 'read', id: 'call-1' });
    expect(parsed).toEqual({ id: 'call-1', name: 'read', summary: '' });
  });

  it('marks tools done on stream done', () => {
    const tools = applyRelayToolEvent(
      [{ id: 'a', name: 'read', status: 'running', summary: '' }],
      { type: 'done', data: {} },
    );
    expect(tools).toEqual([]);
  });

  it('matches tool_result by call id', () => {
    const tools = applyRelayToolEvent(
      [{ id: 'call-1', name: 'read', status: 'running', summary: '' }],
      { type: 'tool_result', data: { call_id: 'call-1' } },
    );
    expect(tools[0].status).toBe('done');
  });
});
