import { extractFromHtml } from '@extractus/article-extractor';

const MAX_CONTENT_LENGTH = 500 * 1024; // 500KB

export interface ExtractedContent {
  title: string;
  textContent: string;
  length: number;
}

/**
 * Extract readable content from HTML using @extractus/article-extractor.
 * Falls back to raw text stripping if extraction fails.
 */
export async function extractContent(
  html: string,
  sourceUrl: string
): Promise<ExtractedContent> {
  try {
    const article = await extractFromHtml(html, sourceUrl);

    if (article && article.content) {
      // article-extractor returns HTML in content, convert to text
      const textContent = htmlToText(article.content);
      const title = article.title || '';

      if (textContent.trim().length > 0) {
        const truncated = textContent.length > MAX_CONTENT_LENGTH
          ? textContent.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated at 500KB]'
          : textContent;

        return {
          title,
          textContent: truncated,
          length: truncated.length,
        };
      }
    }
  } catch {
    // Extraction failed, fall through to raw fallback
  }

  // Fallback: strip HTML tags and return raw text
  const rawText = htmlToText(html);
  const truncated = rawText.length > MAX_CONTENT_LENGTH
    ? rawText.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated at 500KB]'
    : rawText;

  return {
    title: '',
    textContent: truncated || '(empty page)',
    length: truncated.length,
  };
}

/**
 * Simple HTML to plain text conversion.
 * Strips tags, decodes entities, collapses whitespace.
 */
function htmlToText(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|dt|dd)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
