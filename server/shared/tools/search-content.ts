import fs from 'fs';
import path from 'path';
import { toolRegistry } from './registry';
import { resolveToolPath } from './path-validator';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

function isBinary(buffer: Buffer): boolean {
  // Check for null bytes in first 8KB
  const sample = buffer.slice(0, 8192);
  return sample.includes(0);
}

function searchInFile(filePath: string, pattern: RegExp): Array<{ file: string; line: string; lineNumber: number; match: string }> {
  const results: Array<{ file: string; line: string; lineNumber: number; match: string }> = [];
  try {
    const buffer = fs.readFileSync(filePath);
    if (isBinary(buffer)) return results;

    const content = buffer.toString('utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pattern);
      if (match) {
        results.push({
          file: filePath,
          line: lines[i].trim().slice(0, 200),
          lineNumber: i + 1,
          match: match[0],
        });
      }
    }
  } catch {
    // Skip unreadable files
  }
  return results;
}

function walkDir(dirPath: string, pattern: RegExp, maxResults: number): {
  matches: Array<{ file: string; line: string; lineNumber: number; match: string }>;
  truncated: boolean;
  totalFound: number;
} {
  const matches: Array<{ file: string; line: string; lineNumber: number; match: string }> = [];
  let totalFound = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const result = walkDir(fullPath, pattern, maxResults - matches.length);
        matches.push(...result.matches);
        totalFound += result.totalFound;
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }
        const fileMatches = searchInFile(fullPath, pattern);
        totalFound += fileMatches.length;
        const relativePath = path.relative(process.cwd(), fullPath);
        for (const m of fileMatches) {
          if (matches.length >= maxResults) break;
          matches.push({ ...m, file: relativePath });
        }
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return { matches, truncated: totalFound > maxResults, totalFound };
}

toolRegistry.register({
  name: 'search_content',
  description: 'Search for a regex pattern in files under a directory. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory path to search in, relative to workspace root',
      },
    },
    required: ['pattern', 'path'],
  },
  execute: async (args, context) => {
    try {
      const resolvedPath = resolveToolPath(args.path as string, context.workspacePath);

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Path not found: ${args.path}` };
      }

      let pattern: RegExp;
      try {
        const patternStr = args.pattern as string;
        // Reject dangerous patterns that cause catastrophic backtracking
        if (patternStr.length > 200) {
          return { success: false, error: 'Pattern too long (max 200 chars)' };
        }
        // Reject nested quantifiers: (a+)+, (a*)*, ((a|b)+)+ etc.
        if (/\(\s*(?:\(|\w\+|\w\*)\)\s*\+/.test(patternStr)) {
          return { success: false, error: 'Pattern contains potentially unsafe nested quantifier' };
        }
        pattern = new RegExp(patternStr, 'gi');
      } catch {
        return { success: false, error: `Invalid regex pattern: ${args.pattern}` };
      }

      const { matches, truncated, totalFound } = walkDir(resolvedPath, pattern, 50);

      let data = { matches };
      if (truncated) {
        (data as Record<string, unknown>).note = `[... and ${totalFound - 50} more matches]`;
      }

      return { success: true, data };
    } catch (err) {
      if (err instanceof Error && err.name === 'PathError') {
        return { success: false, error: err.message };
      }
      return { success: false, error: err instanceof Error ? err.message : 'Search failed' };
    }
  },
});
