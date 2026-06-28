import type { AgentCapability } from '../../../shared/types';
import { describe, it, expect, beforeAll } from 'vitest';
import { agentRegistry } from './registry';
import { OPERATING_MODES, AGENT_ROLES, compositeId, compositeName, promptFileKey } from './config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function registerAgent(
  id: string,
  name: string,
  description: string,
  promptFileName: string,
  tools: string[],
  capCategories: string[],
  iconKey: string,
): void {
  if (agentRegistry.get(id)) return;
  const promptPath = path.resolve(__dirname, 'prompts', `${promptFileName}.md`);
  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  } catch {
    console.warn(`[Kavis test] Prompt file not found for "${promptFileName}.md"`);
  }
  agentRegistry.register({
    id,
    name,
    description,
    systemPrompt,
    tools,
    capabilities: capCategories.map((c) => ({ category: c as any, level: 4 } as AgentCapability)),
    iconKey,
    status: 'active',
  });
}

function registerAllAgents(): void {
  const workMode = OPERATING_MODES.find((m) => m.id === 'work')!;
  registerAgent(
    'work',
    workMode.name,
    workMode.description,
    'work-mode',
    workMode.tools,
    workMode.capabilities.map((c) => c.category),
    workMode.iconKey,
  );

  const codeMode = OPERATING_MODES.find((m) => m.id === 'code')!;
  for (const role of AGENT_ROLES) {
    registerAgent(
      compositeId('code', role.id),
      compositeName(codeMode.name, role.name),
      role.description,
      promptFileKey('code', role.id),
      codeMode.tools,
      codeMode.capabilities.map((c) => c.category),
      codeMode.iconKey,
    );
  }
}

describe('Agent Registry — Mode + Role Architecture', () => {
  beforeAll(() => {
    registerAllAgents();
  });

  it('should have 6 composite agents registered (work + 5 code roles)', () => {
    const agents = agentRegistry.list();
    expect(agents.length).toBe(6);
  });

  it('should have work, code/agentic, code/plan, code/ask, code/debug, code/kavis-code', () => {
    const ids = agentRegistry.list().map((a) => a.id);
    expect(ids).toContain('work');
    expect(ids).toContain('code/agentic');
    expect(ids).toContain('code/plan');
    expect(ids).toContain('code/ask');
    expect(ids).toContain('code/debug');
    expect(ids).toContain('code/kavis-code');
  });

  it('all 5 agents should be active', () => {
    for (const id of ['work', 'code/agentic', 'code/plan', 'code/ask', 'code/debug']) {
      const agent = agentRegistry.get(id);
      expect(agent).toBeDefined();
      expect(agent!.status).toBe('active');
    }
  });

  it('work agent should have all tools including web', () => {
    const tools = agentRegistry.getToolNames('work');
    expect(tools).toContain('web_search');
    expect(tools).toContain('web_fetch');
    expect(tools).toContain('read_file');
    expect(tools).toContain('write_file');
    expect(tools).toContain('shell_exec');
    expect(tools).toContain('git_status');
  });

  it('code agents should have all tools including web', () => {
    const tools = agentRegistry.getToolNames('code/agentic');
    expect(tools).toContain('web_search');
    expect(tools).toContain('web_fetch');
    expect(tools).toContain('read_file');
    expect(tools).toContain('write_file');
    expect(tools).toContain('shell_exec');
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_diff');
  });

  it('all composite agents should have non-empty system prompts', () => {
    for (const id of ['work', 'code/agentic', 'code/plan', 'code/ask', 'code/debug']) {
      const agent = agentRegistry.get(id);
      expect(agent?.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('get returns undefined for unknown agent', () => {
    expect(agentRegistry.get('nonexistent')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    expect(() =>
      agentRegistry.register({
        id: 'work',
        name: 'Duplicate',
        description: '',
        systemPrompt: '',
        tools: [],
        capabilities: [],
      })
    ).toThrow('already registered');
  });

  it('promptFileKey works for mode-only', () => {
    expect(promptFileKey('work')).toBe('work-mode');
  });

  it('promptFileKey works for mode+role', () => {
    expect(promptFileKey('code', 'agentic')).toBe('code-agentic-mode');
    expect(promptFileKey('code', 'plan')).toBe('code-plan-mode');
  });

  it('compositeId works correctly', () => {
    expect(compositeId('work')).toBe('work');
    expect(compositeId('code', 'agentic')).toBe('code/agentic');
    expect(compositeId('code', 'debug')).toBe('code/debug');
  });

  it('compositeName works correctly', () => {
    expect(compositeName('Work Mode')).toBe('Work Mode');
    expect(compositeName('Code Mode', 'Agentic')).toBe('Code Mode — Agentic');
  });
});