import type { ModeDefinition, RoleDefinition } from '../../../shared/types';

/**
 * Operating modes — control which tools are available to the agent.
 *
 * Work Mode  → office/personal assistant: web search, file ops, git, shell.
 * Code Mode  → coding agent: same as work + tools needed for reading/editing code.
 */
export const OPERATING_MODES: ModeDefinition[] = [
  {
    id: 'work',
    name: 'Work Mode',
    description: 'Daily productivity — search, read, write files, run commands',
    tools: [
      'web_search', 'web_fetch',
      'read_file', 'write_file', 'list_dir', 'get_project_tree', 'search_content',
      'shell_exec',
      'git_status', 'git_diff',
    ],
    capabilities: [
      { category: 'docs' },
      { category: 'analysis' },
      { category: 'file_ops' },
      { category: 'ops' },
    ],
    iconKey: 'briefcase',
  },
  {
    id: 'code',
    name: 'Code Mode',
    description: 'AI-powered coding — read, edit, debug, and review code',
    tools: [
      'web_search', 'web_fetch',
      'read_file', 'write_file', 'list_dir', 'get_project_tree', 'search_content',
      'shell_exec',
      'git_status', 'git_diff',
    ],
    capabilities: [
      { category: 'coding' },
      { category: 'docs' },
      { category: 'analysis' },
      { category: 'file_ops' },
    ],
    iconKey: 'code2',
  },
];

/**
 * Agent roles — only meaningful within Code Mode.
 * Each role represents a different methodology / system prompt.
 */
export const AGENT_ROLES: RoleDefinition[] = [
  {
    id: 'agentic',
    name: 'Agentic',
    description: 'Full autonomy — reads, edits, debugs, and completes tasks',
  },
  {
    id: 'plan',
    name: 'Plan',
    description: 'Plan before acting — clarifies requirements then creates step-by-step plans',
  },
  {
    id: 'ask',
    name: 'Ask',
    description: 'Read-only research — search, read, analyze, explain',
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Systematic debugging — investigate, diagnose, and fix issues',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: '基于 Search-Replace 差异块协议的原生 Coding Agent MVP',
  },
];

/**
 * Build the prompt file name for a given mode and optional role.
 *
 * Work Mode  → "work-mode"
 * Code + Agentic → "code-agentic-mode"
 * Code + Plan    → "code-plan-mode"
 */
export function promptFileKey(modeId: string, roleId?: string): string {
  return roleId ? `${modeId}-${roleId}-mode` : `${modeId}-mode`;
}

/**
 * Build the composite agent registry id.
 *
 * Work Mode  → "work"
 * Code + Agentic → "code/agentic"
 * Code + Plan    → "code/plan"
 */
export function compositeId(modeId: string, roleId?: string): string {
  return roleId ? `${modeId}/${roleId}` : modeId;
}

/**
 * Build a human-readable composite name.
 *
 * "Work Mode"
 * "Code Mode — Agentic"
 */
export function compositeName(modeName: string, roleName?: string): string {
  return roleName ? `${modeName} — ${roleName}` : modeName;
}