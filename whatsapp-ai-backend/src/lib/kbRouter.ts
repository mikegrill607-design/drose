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

function scoreEntries(entries: KnowledgeBaseEntry[], searchText: string): KnowledgeBaseEntry[] {
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

export function selectRelevantKb(
  entries: KnowledgeBaseEntry[],
  recentMessages: { sender: string; content: string }[],
  // AI replies only need recent context (keeps token cost down), but
  // webhook.ts's product-guessing for handoffs/lead capture wants the whole
  // conversation -- an early "kemeja lelaki ada?" shouldn't be forgotten just
  // because the qualifying size/color details came several messages later.
  messageWindow: number = RECENT_MESSAGES_FOR_MATCHING
): KnowledgeBaseEntry[] {
  const customerMessages = recentMessages.filter((m) => m.sender === 'customer');

  // Score the LAST customer message alone first -- a clear topic switch
  // ("kemeja ada?" ... several messages later ... "actually kain pasang
  // pulak, warna apa ada?") should win immediately, not get outvoted by an
  // earlier product that happened to be mentioned more times overall
  // (previously scored by raw keyword count across the whole window, which
  // let an early product dominate long after the customer had moved on).
  // Only falls back to the full window when the latest message alone has
  // no product signal at all (e.g. "saiz M, pendek" -- an attribute reply
  // that doesn't name a product), so early context still isn't lost.
  const lastMessage = customerMessages[customerMessages.length - 1];
  if (lastMessage) {
    const lastOnly = scoreEntries(entries, lastMessage.content.toLowerCase());
    if (lastOnly.length > 0) return lastOnly;
  }

  const searchText = customerMessages
    .slice(-messageWindow)
    .map((m) => m.content)
    .join(' \n ')
    .toLowerCase();

  return scoreEntries(entries, searchText);
}
