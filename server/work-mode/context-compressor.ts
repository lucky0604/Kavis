import { countTokens } from 'gpt-tokenizer';
import type { Message } from '../../shared/types';

const COMPRESSION_THRESHOLD = 0.8;
const DEFAULT_MODEL_MAX_TOKENS = 128000;
const KEEP_RECENT_TURNS = 4;

export interface CompressionConfig {
  modelMaxTokens?: number;
  threshold?: number;
  keepRecentTurns?: number;
}

export class ContextCompressor {
  private config: Required<CompressionConfig>;

  constructor(config: CompressionConfig = {}) {
    this.config = {
      modelMaxTokens: config.modelMaxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
      threshold: config.threshold ?? COMPRESSION_THRESHOLD,
      keepRecentTurns: config.keepRecentTurns ?? KEEP_RECENT_TURNS,
    };
  }

  getTokenCount(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += countTokens(msg.content);
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += countTokens(JSON.stringify(tc.arguments));
        }
      }
    }
    return total;
  }

  shouldCompress(messages: Message[]): boolean {
    const tokenCount = this.getTokenCount(messages);
    return tokenCount > this.config.threshold * this.config.modelMaxTokens;
  }

  compress(messages: Message[]): Message[] {
    // Preserve system messages except previous compression summaries
    const systemMessages = messages.filter(
      (m) => m.role === 'system' && m.id !== 'compression-summary'
    );
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Find turn boundaries (user message starts a turn)
    const turns: Message[][] = [];
    let currentTurn: Message[] = [];

    for (const msg of nonSystemMessages) {
      if (msg.role === 'user' && currentTurn.length > 0) {
        turns.push(currentTurn);
        currentTurn = [];
      }
      currentTurn.push(msg);
    }
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    // Keep recent turns
    const recentTurns = turns.slice(-this.config.keepRecentTurns);
    const olderTurns = turns.slice(0, -this.config.keepRecentTurns);

    // If there are older turns, create a summary
    const result: Message[] = [...systemMessages];

    if (olderTurns.length > 0) {
      const summary = this.createSummary(olderTurns);
      result.push({
        id: 'compression-summary',
        role: 'system',
        content: summary,
        timestamp: Date.now(),
      });
    }

    // Add recent turns
    for (const turn of recentTurns) {
      result.push(...turn);
    }

    return result;
  }

  private createSummary(olderTurns: Message[][]): string {
    const turnCount = olderTurns.length;
    const userMessages = olderTurns
      .map((t) => t.find((m) => m.role === 'user'))
      .filter(Boolean)
      .slice(-5);

    const summary = [
      `[Context compressed to stay within token limit]`,
      `Earlier conversation summary (${turnCount} turns, ${userMessages.length} user messages):`,
      ...userMessages.map((m) => `- User asked: "${m!.content.slice(0, 100)}${m!.content.length > 100 ? '...' : ''}"`),
      '',
      'The conversation continues below.',
    ].join('\n');

    return summary;
  }
}
