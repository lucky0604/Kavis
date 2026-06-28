// ---- Agent System ----
export type CapabilityCategory = 'coding' | 'docs' | 'analysis' | 'testing' | 'file_ops' | 'ops';

export interface AgentCapability {
  category: CapabilityCategory;
  level: 1 | 2 | 3 | 4 | 5;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  capabilities: AgentCapability[];
  iconKey?: string;
  status?: 'active' | 'coming_soon';
}

// ---- Operating Mode + Agent Role (two-dimensional architecture) ----
export type OperatingModeId = 'work' | 'code';
export type AgentRoleId = 'agentic' | 'plan' | 'ask' | 'debug' | 'kavis-code';

export interface ModeCapability {
  category: string;
}

export interface ModeDefinition {
  id: OperatingModeId;
  name: string;
  description: string;
  tools: string[];
  capabilities: ModeCapability[];
  iconKey: string;
}

export interface RoleDefinition {
  id: AgentRoleId;
  name: string;
  description: string;
}
