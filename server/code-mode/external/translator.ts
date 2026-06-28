import type { Message, CliToolId } from '../../../shared/types';

export interface TranslatedContext {
  workspacePath: string;
  previousAgent: string;
  nextAgent: string;
  instruction: string;
  todos: string[];
}

const TODO_PATTERNS = [
  /(?:TODO|todo|Todo)[\s:：]+(.+)/g,
  /(?:FIXME|fixme|Fixme)[\s:：]+(.+)/g,
  /- \[ \]\s+(.+)/g,
  /(?:需要|应该|请|建议)(.{10,80})/g,
];

const PLAN_KEYWORDS = [
  'implement', 'fix', 'refactor', 'update', 'add', 'remove', 'migrate',
  '实现', '修复', '重构', '更新', '添加', '删除', '迁移',
];

/**
 * Parses session messages to extract actionable TODO items
 * and generate a structured handoff context payload.
 */
export function translateContext(
  messages: Message[],
  workspacePath: string,
  previousCli: CliToolId,
  nextCli: CliToolId,
): TranslatedContext {
  const todos = new Set<string>();

  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const recentMessages = assistantMessages.slice(-10);

  for (const msg of recentMessages) {
    for (const pattern of TODO_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(msg.content)) !== null) {
        const item = match[1].trim();
        if (item.length > 5 && item.length < 200) {
          todos.add(item);
        }
      }
    }

    for (const keyword of PLAN_KEYWORDS) {
      const lines = msg.content.split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes(keyword) && line.trim().length > 10 && line.trim().length < 200) {
          const cleaned = line.replace(/^[\s\-*#>]+/, '').trim();
          if (cleaned.length > 10) {
            todos.add(cleaned);
          }
        }
      }
    }
  }

  const todoArray = Array.from(todos).slice(0, 5);

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const instruction = lastUserMsg
    ? lastUserMsg.content.slice(0, 500)
    : 'Continue working on the current task';

  return {
    workspacePath,
    previousAgent: cliDisplayName(previousCli),
    nextAgent: cliDisplayName(nextCli),
    instruction,
    todos: todoArray,
  };
}

/**
 * Generate a markdown handoff payload from translated context.
 */
export function generateHandoffMarkdown(ctx: TranslatedContext): string {
  const lines = [
    `## Baton Handoff: ${ctx.previousAgent} → ${ctx.nextAgent}`,
    '',
    `**Workspace:** \`${ctx.workspacePath}\``,
    '',
    '### Instruction',
    ctx.instruction,
    '',
    '### TODO Checklist',
  ];

  if (ctx.todos.length === 0) {
    lines.push('- [ ] Continue from where the previous agent left off');
  } else {
    for (const todo of ctx.todos) {
      lines.push(`- [ ] ${todo}`);
    }
  }

  return lines.join('\n');
}

function cliDisplayName(cli: CliToolId): string {
  switch (cli) {
    case 'claudecode': return 'Claude Code';
    case 'opencode': return 'OpenCode';
    default: return cli;
  }
}
