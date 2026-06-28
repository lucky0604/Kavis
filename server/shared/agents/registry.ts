import type { AgentDefinition } from '../../../shared/types';

class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /** Return only agents with status 'active'. */
  listActive(): AgentDefinition[] {
    return this.list().filter((a) => a.status === 'active' || a.status === undefined);
  }

  getToolNames(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    return agent ? agent.tools : [];
  }
}

export const agentRegistry = new AgentRegistry();