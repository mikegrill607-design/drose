import { KnowledgeBaseEntry } from '../types';

const RECENT_MESSAGES_FOR_MATCHING = 4;
const MAX_CATEGORIES_INCLUDED = 3;

// Boutique-scale KB (10-20 categories) doesn't need embeddings/vector search
// -- matching product/topic keywords against the last few customer messages
// is reliable at this size, costs nothing extra per request, and is easy to
// debug ("why did the AI mention X" -> because the customer said a keyword
// tied to X). Keeps every AI call from paying for the entire KB in tokens
// regardless of what was actually asked.
function tokensFor(entry: Pick<KnowledgeBaseEntry, 'topic' | 'keywords'>): string[] {
  const fromTopic = entry.topic.replace(/^product_/, '').split(/[_\s]+/);
  const fromKeywords = (entry.keywords ?? '').split(',').map((k) => k.trim());
  return [...fromTopic, ...fromKeywords].map((t) => t.toLowerCase()).filter((t) => t.length > 1);
}

export function selectRelevantKb(
  entries: KnowledgeBaseEntry[],
  recentMessages: { sender: string; content: string }[],
  // AI replies only need recent context (keeps token cost down), but
  // webhook.ts's product-guessing for handoffs/lead capture wants the whole
  // conversation -- an early "kemeja lelaki ada?" shouldn't be forgotten just
  // because the qualifying size/color details came several messages later.
  messageWindow: number = RECENT_MESSAGES_FOR_MATCHING
): KnowledgeBaseEntry[] {
  const searchText = recentMessages
    .filter((m) => m.sender === 'customer')
    .slice(-messageWindow)
    .map((m) => m.content)
    .join(' \n ')
    .toLowerCase();

  if (!searchText.trim()) return [];

  const scored = entries
    .map((entry) => {
      const matchCount = tokensFor(entry).filter((token) => searchText.includes(token)).length;
      return { entry, matchCount };
    })
    .filter((s) => s.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

  return scored.slice(0, MAX_CATEGORIES_INCLUDED).map((s) => s.entry);
}
