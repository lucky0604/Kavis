import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { agentRegistry } from '../shared/agents/registry';
import { OPERATING_MODES, AGENT_ROLES, promptFileKey, compositeId, compositeName } from '../shared/agents/config';

export function registerAgentWithDir(
  promptsDir: string,
  id: string,
  name: string,
  description: string,
  promptFileName: string,
  tools: string[],
  capCategories: string[],
  iconKey: string,
): void {
  if (agentRegistry.get(id)) return;
  const promptPath = path.join(promptsDir, `${promptFileName}.md`);
  let systemPrompt = '';
  try {
    systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  } catch {
    console.warn(`[Kavis] Prompt file not found: ${promptPath}`);
  }
  agentRegistry.register({
    id, name, description, systemPrompt,
    tools,
    capabilities: capCategories.map((c) => ({ category: c as any, level: 4 })),
    iconKey,
    status: 'active',
  });
}

export function registerAllAgents(promptsDir: string): void {
  const register = (
    id: string, name: string, description: string,
    promptFileName: string, tools: string[], capCategories: string[], iconKey: string,
  ) => registerAgentWithDir(promptsDir, id, name, description, promptFileName, tools, capCategories, iconKey);

  for (const mode of OPERATING_MODES) {
    if (mode.id === 'work') {
      register('work', mode.name, mode.description,
        promptFileKey('work'), mode.tools,
        mode.capabilities.map((c) => c.category), mode.iconKey);
    }
  }

  for (const mode of OPERATING_MODES) {
    if (mode.id !== 'code') continue;
    for (const role of AGENT_ROLES) {
      register(compositeId(mode.id, role.id),
        compositeName(mode.name, role.name), role.description,
        promptFileKey(mode.id, role.id), mode.tools,
        mode.capabilities.map((c) => c.category), mode.iconKey);
    }
  }
}

/**
 * Handle GET /api/agents — return modes + roles for the frontend.
 */
export function handleAgentsList(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const modes = OPERATING_MODES.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    capabilities: m.capabilities.map((c) => c.category),
    iconKey: m.iconKey,
  }));
  const roles = AGENT_ROLES.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ modes, roles }));
  return Promise.resolve();
}
