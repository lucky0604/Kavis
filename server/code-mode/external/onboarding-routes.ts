import type { IncomingMessage, ServerResponse } from 'http';
import { execSync } from 'child_process';
import { detectAllClis } from './cli-registry';

interface CliOnboardingInfo {
  id: string;
  name: string;
  available: boolean;
  version: string | null;
  installHint: string;
}

interface OnboardingStatus {
  workspace: {
    path: string;
    hasGit: boolean;
    branch: string | null;
    isClean: boolean;
  };
  clis: CliOnboardingInfo[];
  environment: {
    hasAnthropicKey: boolean;
    hasOpenaiKey: boolean;
    nodeVersion: string;
    platform: string;
  };
  sessions: {
    count: number;
  };
}

function getGitBranch(cwd: string): string | null {
  try {
    return execSync('git branch --show-current', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function isGitClean(cwd: string): boolean {
  try {
    const out = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out.length === 0;
  } catch {
    return false;
  }
}

function hasGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function getCliVersion(binaryName: string): string | null {
  try {
    const out = execSync(`${binaryName} --version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = out.match(/[\d]+\.[\d]+\.[\d]+/);
    return match ? match[0] : out.split('\n')[0].slice(0, 30);
  } catch {
    return null;
  }
}

const INSTALL_HINTS: Record<string, string> = {
  claudecode: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  opencode: 'brew install opencode-ai/tap/opencode',
};

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function handleOnboardingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  workspacePath: string,
): boolean {
  if (urlPath === '/api/onboarding/status' && req.method === 'GET') {
    const cliResults = detectAllClis();

    const clis: CliOnboardingInfo[] = cliResults.map((cli) => ({
      id: cli.id,
      name: cli.displayName,
      available: cli.available,
      version: cli.available ? getCliVersion(cli.id === 'claudecode' ? 'claude' : cli.id) : null,
      installHint: INSTALL_HINTS[cli.id] || '',
    }));

    const status: OnboardingStatus = {
      workspace: {
        path: workspacePath,
        hasGit: hasGitRepo(workspacePath),
        branch: getGitBranch(workspacePath),
        isClean: isGitClean(workspacePath),
      },
      clis,
      environment: {
        hasAnthropicKey: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
        hasOpenaiKey: !!process.env.OPENAI_API_KEY,
        nodeVersion: process.version,
        platform: process.platform,
      },
      sessions: {
        count: 0,
      },
    };

    json(res, 200, status);
    return true;
  }

  return false;
}
