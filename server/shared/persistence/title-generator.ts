import OpenAI from 'openai';
import type { Message } from '../../../shared/types';
import { BROWSER_HEADERS } from '../ai/headers';
import { upstreamFetch } from '../ai/upstream-fetch';

export interface TitleGenerationOptions {
  apiKey: string;
  baseUrl?: string;
  modelName?: string;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT =
  'Generate a concise 3-6 word title for this conversation. Output ONLY the title text, no quotes, no surrounding punctuation, no trailing period. Match the language of the user message (if user wrote Chinese, respond in Chinese).';

export async function generateTitle(
  messages: Message[],
  options: TitleGenerationOptions,
): Promise<string | null> {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser?.content?.trim()) return null;

  const firstAssistant = messages.find(
    (m) => m.role === 'assistant' && m.content?.trim(),
  );

  const userExcerpt = firstUser.content.trim().slice(0, 500);
  const assistantExcerpt = (firstAssistant?.content || '').trim().slice(0, 300);

  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl?.trim() || process.env.OPENAI_BASE_URL,
    defaultHeaders: BROWSER_HEADERS,
    fetch: upstreamFetch,
  });

  const userPayload = assistantExcerpt
    ? `User: ${userExcerpt}\n\nAssistant: ${assistantExcerpt}`
    : `User: ${userExcerpt}`;

  try {
    const res = await client.chat.completions.create(
      {
        model: options.modelName || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload },
        ],
        max_tokens: 32,
        temperature: 0.3,
        stream: false,
      },
      { signal: options.signal },
    );

    const raw = res.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const cleaned = raw
      .replace(/^["'`""''《》「」『』]+|["'`""''《》「」『』]+$/g, '')
      .replace(/[。．.!！?？…]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.length > 60) return null;
    return cleaned;
  } catch {
    return null;
  }
}
