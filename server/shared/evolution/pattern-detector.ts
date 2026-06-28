/**
 * Pattern Detector — Identify recurring operation patterns
 *
 * Analyzes conversation history to detect:
 * - Repeated tool sequences (could become a skill)
 * - Frequent file patterns (project conventions)
 * - Common error patterns (knowledge gaps)
 * - User preference patterns (style choices)
 */

import type { Message } from '../../../shared/types';

export interface DetectedPattern {
  type: 'tool_sequence' | 'file_pattern' | 'error_pattern' | 'preference';
  description: string;
  frequency: number;       // How many times observed
  confidence: number;      // 0-1, how certain the pattern is real
  suggestedAction: string; // What to do about it
  evidence: string[];      // Supporting evidence
}

export class PatternDetector {
  private toolSequences: Map<string, number> = new Map();
  private fileExtensions: Map<string, number> = new Map();
  private errors: Map<string, number> = new Map();
  private userPreferences: Map<string, number> = new Map();

  /**
   * Analyze messages and detect patterns.
   */
  detect(messages: Message[]): DetectedPattern[] {
    this.reset();
    const patterns: DetectedPattern[] = [];

    // 1. Analyze tool sequences
    const toolSeqs = this.analyzeToolSequences(messages);
    patterns.push(...toolSeqs);

    // 2. Analyze file patterns
    const filePats = this.analyzeFilePatterns(messages);
    patterns.push(...filePats);

    // 3. Analyze error patterns
    const errorPats = this.analyzeErrorPatterns(messages);
    patterns.push(...errorPats);

    // 4. Analyze preference patterns
    const prefPats = this.analyzePreferencePatterns(messages);
    patterns.push(...prefPats);

    // Sort by confidence (descending)
    patterns.sort((a, b) => b.confidence - a.confidence);

    return patterns;
  }

  private reset(): void {
    this.toolSequences.clear();
    this.fileExtensions.clear();
    this.errors.clear();
    this.userPreferences.clear();
  }

  private analyzeToolSequences(messages: Message[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Extract tool call sequences from messages
    const sequences: string[][] = [];
    let currentSeq: string[] = [];

    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          currentSeq.push(tc.name);
        }
      } else if (msg.role === 'user' && currentSeq.length > 0) {
        sequences.push(currentSeq);
        currentSeq = [];
      }
    }
    if (currentSeq.length > 0) sequences.push(currentSeq);

    // Count 2-grams and 3-grams
    for (const seq of sequences) {
      // 2-grams
      for (let i = 0; i < seq.length - 1; i++) {
        const key = `${seq[i]} → ${seq[i + 1]}`;
        this.toolSequences.set(key, (this.toolSequences.get(key) || 0) + 1);
      }

      // 3-grams
      for (let i = 0; i < seq.length - 2; i++) {
        const key = `${seq[i]} → ${seq[i + 1]} → ${seq[i + 2]}`;
        this.toolSequences.set(key, (this.toolSequences.get(key) || 0) + 1);
      }
    }

    // Convert frequent sequences to patterns
    for (const [seq, count] of this.toolSequences.entries()) {
      if (count >= 3) {
        patterns.push({
          type: 'tool_sequence',
          description: `Repeated tool sequence: ${seq}`,
          frequency: count,
          confidence: Math.min(count / 5, 1),
          suggestedAction: `Consider creating a skill that combines: ${seq}`,
          evidence: [`Observed ${count} times in this session`],
        });
      }
    }

    return patterns;
  }

  private analyzeFilePatterns(messages: Message[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Extract file paths from tool arguments
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const filePath = (tc.arguments as Record<string, unknown>)?.path as string
            || (tc.arguments as Record<string, unknown>)?.filePath as string
            || (tc.arguments as Record<string, unknown>)?.file_path as string;

          if (filePath) {
            const ext = filePath.split('.').pop() || '';
            if (ext) {
              this.fileExtensions.set(ext, (this.fileExtensions.get(ext) || 0) + 1);
            }
          }
        }
      }
    }

    // Convert dominant extensions to patterns
    const total = [...this.fileExtensions.values()].reduce((a, b) => a + b, 0);
    if (total >= 5) {
      for (const [ext, count] of this.fileExtensions.entries()) {
        if (count / total >= 0.4 && count >= 3) {
          patterns.push({
            type: 'file_pattern',
            description: `Dominant file type: .${ext}`,
            frequency: count,
            confidence: Math.min(count / total, 1),
            suggestedAction: `Note .${ext} as primary file type in project knowledge`,
            evidence: [`.${ext} files appear in ${count}/${total} file operations`],
          });
        }
      }
    }

    return patterns;
  }

  private analyzeErrorPatterns(messages: Message[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Look for error messages in tool results
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.content.includes('Error:')) {
        const errorType = msg.content.split('Error:')[1]?.split('\n')[0]?.trim() || 'unknown';
        this.errors.set(errorType, (this.errors.get(errorType) || 0) + 1);
      }
    }

    for (const [errorType, count] of this.errors.entries()) {
      if (count >= 2) {
        patterns.push({
          type: 'error_pattern',
          description: `Recurring error: ${errorType}`,
          frequency: count,
          confidence: Math.min(count / 4, 1),
          suggestedAction: `Create a procedure to avoid or handle: ${errorType}`,
          evidence: [`Error occurred ${count} times`],
        });
      }
    }

    return patterns;
  }

  private analyzePreferencePatterns(messages: Message[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Look for preference indicators in user messages
    const preferencePatterns = [
      /\b(I prefer|I like|I want|I always|I never|I usually|please use|don't use)\b/gi,
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;

      for (const regex of preferencePatterns) {
        const matches = msg.content.matchAll(regex);
        for (const match of matches) {
          const context = msg.content.slice(
            Math.max(0, match.index! - 20),
            Math.min(msg.content.length, match.index! + match[0].length + 80)
          );
          this.userPreferences.set(context, (this.userPreferences.get(context) || 0) + 1);
        }
      }
    }

    for (const [pref, count] of this.userPreferences.entries()) {
      if (count >= 1) {
        patterns.push({
          type: 'preference',
          description: `User preference detected: "${pref.slice(0, 100)}"`,
          frequency: count,
          confidence: 0.6,
          suggestedAction: 'Save as a user preference in memory',
          evidence: [`Stated ${count} time(s)`],
        });
      }
    }

    return patterns;
  }
}
