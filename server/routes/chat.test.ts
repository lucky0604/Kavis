import type { AgentCapability } from '../../shared/types';
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveModeRole, resolveAgentTools } from './chat';
import { agentRegistry } from '../shared/agents/registry';
import { toolRegistry } from '../shared/tools/registry';
import { OPERATING_MODES, AGENT_ROLES, compositeId } from '../shared/agents/config';

const MOCK_TOOL_NAMES = [
  'web_search', 'web_fetch',
  'read_file', 'write_file',
  'list_dir', 'get_project_tree',
  'search_content',
  'shell_exec',
  'git_status', 'git_diff',
];

function registerMockTools() {
  for (const name of MOCK_TOOL_NAMES) {
    if (!toolRegistry.get(name)) {
      toolRegistry.register({
        name,
        description: `Mock ${name}`,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => ({ success: true, data: 'mock' }),
      });
    }
  }
  if (!toolRegistry.get('patch_file')) {
    toolRegistry.register({
      name: 'patch_file',
      description: 'Mock patch_file',
      parameters: { type: 'object' as const, properties: {} },
      execute: async () => ({ success: true, data: 'mock' }),
    });
  }
}

function registerTestAgents() {
  for (const mode of OPERATING_MODES) {
    if (mode.id === 'work') {
      if (!agentRegistry.get('work')) {
        agentRegistry.register({
          id: 'work',
          name: mode.name,
          description: mode.description,
          systemPrompt: 'You are Work Mode.',
          tools: mode.tools,
          capabilities: mode.capabilities.map((c) => ({ category: c.category as any, level: 4 } as AgentCapability)),
          iconKey: mode.iconKey,
          status: 'active',
        });
      }
    }
    if (mode.id === 'code') {
      for (const role of AGENT_ROLES) {
        const id = compositeId('code', role.id);
        if (!agentRegistry.get(id)) {
          agentRegistry.register({
            id,
            name: `Code — ${role.name}`,
            description: role.description,
            systemPrompt: `You are Code Mode — ${role.name}.`,
            tools: mode.tools,
            capabilities: mode.capabilities.map((c) => ({ category: c.category as any, level: 4 } as AgentCapability)),
            iconKey: mode.iconKey,
            status: 'active',
          });
        }
      }
    }
  }
}

describe('Chat Route — Mode + Role Tool Filtering', () => {
  beforeAll(() => {
    registerMockTools();
    registerTestAgents();
  });

  it('resolveModeRole: Work Mode should have all tools', () => {
    const result = resolveModeRole('work', undefined);
    const names = result.tools.map((t) => t.name);
    expect(result.resolvedMode).toBe('work');
    expect(result.resolvedRole).toBeUndefined();
    expect(result.compositeKey).toBe('work');
    expect(names).toEqual(MOCK_TOOL_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it('resolveModeRole: Code Mode defaults to agentic role', () => {
    const result = resolveModeRole('code', undefined);
    expect(result.resolvedMode).toBe('code');
    expect(result.resolvedRole).toBe('agentic');
    expect(result.compositeKey).toBe('code/agentic');
    expect(result.warnings).toHaveLength(0);
  });

  it('resolveModeRole: Code Mode with explicit role', () => {
    const result = resolveModeRole('code', 'plan');
    expect(result.resolvedMode).toBe('code');
    expect(result.resolvedRole).toBe('plan');
    expect(result.compositeKey).toBe('code/plan');
    expect(result.warnings).toHaveLength(0);
  });

  it('resolveModeRole: Code tools include web_search', () => {
    const result = resolveModeRole('code', 'agentic');
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('shell_exec');
    expect(names).toContain('git_status');
  });

  it('resolveModeRole: undefined mode falls back to work', () => {
    const result = resolveModeRole(undefined, undefined);
    expect(result.resolvedMode).toBe('work');
    expect(result.resolvedRole).toBeUndefined();
  });

  it('resolveModeRole: all code roles share the same tool set', () => {
    const ref = resolveModeRole('code', 'agentic');
    for (const role of ['plan', 'ask', 'debug'] as const) {
      const r = resolveModeRole('code', role);
      expect(r.tools.map((t) => t.name)).toEqual(ref.tools.map((t) => t.name));
    }
  });

  it('resolveAgentTools: legacy agentId "work" works', () => {
    const result = resolveAgentTools('work');
    expect(result.resolvedAgentId).toBe('work');
    expect(result.warnings).toHaveLength(0);
  });

  it('resolveModeRole: kavis-code role uses restricted native tool set', () => {
    const result = resolveModeRole('code', 'kavis-code');
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['read_file', 'patch_file', 'write_file', 'shell_exec', 'git_status', 'git_diff']),
    );
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('web_fetch');
  });

  it('resolveAgentTools: legacy agentId undefined falls to work', () => {
    const result = resolveAgentTools(undefined);
    expect(result.resolvedAgentId).toBe('work');
    const hasUnknownWarning = result.warnings.some((w) => w.includes('Unknown agentId'));
    expect(hasUnknownWarning).toBe(false);
  });

  it('resolveAgentTools: unknown legacy agentId falls to work with warning', () => {
    const result = resolveAgentTools('nonexistent');
    expect(result.resolvedAgentId).toBe('work');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown agentId')]),
    );
  });

  it('resolveAgentTools: new mode+role path via 3-arg overload', () => {
    const result = resolveAgentTools(undefined, 'code', 'plan');
    expect(result.resolvedAgentId).toBe('code/plan');
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('write_file');
    expect(names).toContain('shell_exec');
  });
});