import type { Message, StreamEvent } from '../../shared/types';
import { executeDialogTurn } from '../engine/agent-loop';
import { toolRegistry } from '../tools/registry';
import dotenv from 'dotenv';

dotenv.config();

// In-memory message store per session (Phase 1 - no persistence)
const sessionMessages = new Map<string, Message[]>();

export interface ChatStreamRequest {
  messages: Message[];
  workspacePath: string;
  sessionId: string;
  baseUrl?: string;
  modelName?: string;
}

export async function handleChatStream(
  req: ChatStreamRequest,
  signal: AbortSignal
): Promise<ReadableStream> {
  const { messages, sessionId, workspacePath, baseUrl, modelName } = req;
  const resolvedPath =
    workspacePath || process.env.JANUS_WORKSPACE || process.cwd();

  // Store messages in session
  sessionMessages.set(sessionId, [...messages]);

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const tools = toolRegistry.getAll().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        }));

        const config = {
          maxRounds: 10,
          workspacePath: resolvedPath,
          sessionId,
          baseUrl,
          modelName,
        };

        for await (const event of executeDialogTurn(messages, tools, config, signal)) {
          // Check cancelled
          if (signal.aborted) {
            push({ type: 'done', data: { reason: 'cancelled' } });
            controller.close();
            return;
          }

          push(event);

          // Track tool results in messages
          if (event.type === 'tool_result') {
            const current = sessionMessages.get(sessionId) || [];
            const data = event.data as { id: string; name: string; success: boolean; output: string };
            current.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: data.output,
              toolCallId: data.id,
              timestamp: Date.now(),
            });
            sessionMessages.set(sessionId, current);
          }
        }

        push({ type: 'done', data: { reason: 'complete' } });
      } catch (err) {
        push({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Internal server error' },
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Clean up on client disconnect
    },
  });
}

export async function handleGetMessages(sessionId: string): Promise<{ messages: Message[] }> {
  const messages = sessionMessages.get(sessionId) || [];
  return { messages };
}
