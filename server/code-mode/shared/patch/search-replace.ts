import type { PatchEngine } from '../executors';

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

/**
 * Parses a Search-Replace patch into individual blocks.
 */
export function parsePatch(patchContent: string): { success: boolean; blocks?: SearchReplaceBlock[]; error?: string } {
  const lines = patchContent.split(/\r?\n/);
  const blocks: SearchReplaceBlock[] = [];
  let currentBlock: { search: string[]; replace: string[] } | null = null;
  let state: 'none' | 'search' | 'replace' = 'none';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<< SEARCH')) {
      if (state !== 'none') {
        return { success: false, error: `Line ${i + 1}: Unexpected <<<<<<< SEARCH inside another block` };
      }
      currentBlock = { search: [], replace: [] };
      state = 'search';
    } else if (line.startsWith('=======')) {
      if (state !== 'search') {
        return { success: false, error: `Line ${i + 1}: Unexpected ======= outside SEARCH block` };
      }
      state = 'replace';
    } else if (line.startsWith('>>>>>>> REPLACE')) {
      if (state !== 'replace' || !currentBlock) {
        return { success: false, error: `Line ${i + 1}: Unexpected >>>>>>> REPLACE outside REPLACE block` };
      }
      blocks.push({
        search: currentBlock.search.join('\n'),
        replace: currentBlock.replace.join('\n'),
      });
      currentBlock = null;
      state = 'none';
    } else {
      if (state === 'search' && currentBlock) {
        currentBlock.search.push(line);
      } else if (state === 'replace' && currentBlock) {
        currentBlock.replace.push(line);
      }
    }
  }

  if (state !== 'none') {
    return { success: false, error: 'Unclosed Search-Replace block at end of patch' };
  }

  return { success: true, blocks };
}

function getIndentation(line: string): string {
  const match = line.match(/^([ \t]*)/);
  return match ? match[1] : '';
}

function adjustIndentation(replaceLines: string[], indentOffset: string): string[] {
  return replaceLines.map((line) => {
    if (line.trim() === '') return '';
    return indentOffset + line;
  });
}

/**
 * Finds a match in the file lines for the search lines.
 * Returns the matched index and any indentation offset.
 */
function findMatch(
  fileLines: string[],
  searchLines: string[],
  level: 1 | 2
): { index: number; indentOffset: string } {
  if (searchLines.length === 0) {
    return { index: 0, indentOffset: '' };
  }

  const matches: number[] = [];

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let matched = true;
    for (let j = 0; j < searchLines.length; j++) {
      const fileLine = fileLines[i + j];
      const searchLine = searchLines[j];

      if (level === 1) {
        if (fileLine !== searchLine) {
          matched = false;
          break;
        }
      } else {
        if (fileLine.trim() !== searchLine.trim()) {
          matched = false;
          break;
        }
      }
    }

    if (matched) {
      matches.push(i);
    }
  }

  if (matches.length === 0) {
    return { index: -1, indentOffset: '' };
  }

  if (matches.length > 1) {
    return { index: -2, indentOffset: '' }; // Conflict: multiple matches
  }

  const matchedIndex = matches[0];
  let indentOffset = '';

  if (level === 2) {
    let firstNonEmptySearchIdx = 0;
    while (firstNonEmptySearchIdx < searchLines.length && searchLines[firstNonEmptySearchIdx].trim() === '') {
      firstNonEmptySearchIdx++;
    }
    if (firstNonEmptySearchIdx < searchLines.length) {
      const fileIndent = getIndentation(fileLines[matchedIndex + firstNonEmptySearchIdx]);
      const searchIndent = getIndentation(searchLines[firstNonEmptySearchIdx]);

      if (fileIndent.startsWith(searchIndent)) {
        indentOffset = fileIndent.slice(searchIndent.length);
      } else {
        indentOffset = fileIndent;
      }
    }
  }

  return { index: matchedIndex, indentOffset };
}

export class SearchReplaceEngine implements PatchEngine {
  /**
   * Apply a Search-Replace patch to fileContent.
   * Supports 3-level matching (Exact -> Fuzzy -> Rollback).
   */
  applyPatch(
    fileContent: string,
    patchContent: string
  ): { success: boolean; newContent: string; error?: string } {
    // Detect line endings
    const isCrlf = fileContent.includes('\r\n');
    let fileLines = fileContent === '' ? [] : fileContent.split(/\r?\n/);

    const parseResult = parsePatch(patchContent);
    if (!parseResult.success || !parseResult.blocks) {
      return { success: false, newContent: fileContent, error: parseResult.error };
    }

    const { blocks } = parseResult;

    for (const block of blocks) {
      const searchLines = block.search === '' ? [] : block.search.split('\n');
      const replaceLines = block.replace === '' ? [] : block.replace.split('\n');

      if (searchLines.length === 0) {
        // Empty SEARCH block is only allowed for creating new/empty files
        const isFileEmpty = fileLines.length === 0 || (fileLines.length === 1 && fileLines[0] === '');
        if (!isFileEmpty) {
          return {
            success: false,
            newContent: fileContent,
            error: 'Empty SEARCH block is only allowed for new or empty files.',
          };
        }
        fileLines = [...replaceLines];
        continue;
      }

      // Level 1: Exact Match
      let matchResult = findMatch(fileLines, searchLines, 1);

      // Level 2: Fuzzy Match (adaptive whitespace and indentation)
      if (matchResult.index === -1) {
        matchResult = findMatch(fileLines, searchLines, 2);
      }

      // Level 3: Error / Rollback
      if (matchResult.index === -1) {
        return {
          success: false,
          newContent: fileContent,
          error: `Could not find a match for the SEARCH block:\n${block.search}`,
        };
      }

      if (matchResult.index === -2) {
        return {
          success: false,
          newContent: fileContent,
          error: `Found multiple matching locations in the file for the SEARCH block:\n${block.search}`,
        };
      }

      // Apply the patch
      const adjustedReplace = adjustIndentation(replaceLines, matchResult.indentOffset);
      fileLines.splice(matchResult.index, searchLines.length, ...adjustedReplace);
    }

    const joinChar = isCrlf ? '\r\n' : '\n';
    return { success: true, newContent: fileLines.join(joinChar) };
  }
}
