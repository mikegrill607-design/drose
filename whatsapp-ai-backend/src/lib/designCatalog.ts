import { supabase } from './supabase';
import { DesignCatalogEntry } from '../types';

// How many distinct design codes get sent per batch -- a "New handoff"
// storm of 15+ images in one WhatsApp message would be a bad customer
// experience and a lot of wasted media-message cost. Customers see this
// many at a time, then can ask for more. Each code can still bring its own
// 2-3 photos.
export const DESIGN_BATCH_SIZE = 3;

export interface DesignGroup {
  designCode: string;
  imageUrls: string[];
}

export async function designCatalogHasEntriesForTopic(topic: string): Promise<boolean> {
  const { count } = await supabase
    .from('design_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('product_topic', topic)
    .eq('is_active', true);
  return (count ?? 0) > 0;
}

function tagMatches(tag: string | null, needle: string): boolean {
  const tagNorm = (tag ?? '').toLowerCase().trim();
  if (!tagNorm) return false;
  return tagNorm.includes(needle) || needle.includes(tagNorm);
}

interface GroupsResult {
  groups: DesignGroup[];
  // True when the customer named a specific material/color and NOTHING
  // matched it -- distinct from "no material given at all" (browsing).
  // Previously both cases silently fell back to showing every active design
  // for the topic, which meant a customer asking for e.g. "Satin Majestic
  // D'ROSE" could get shown Cotton Viscose designs instead with no
  // indication anything was wrong -- misleading given each material is a
  // distinct price tier. Callers should treat this as a catalog gap (tell
  // the customer, alert staff) rather than substitute unrelated designs.
  specificRequestMatchedNothing: boolean;
}

async function groupsForTopic(topic: string, material: string | null, color: string | null): Promise<GroupsResult> {
  const { data } = await supabase
    .from('design_catalog')
    .select('*')
    .eq('product_topic', topic)
    .eq('is_active', true)
    .order('design_code');

  const entries = (data ?? []) as DesignCatalogEntry[];
  const materialNorm = material?.toLowerCase().trim() || null;
  const colorNorm = color?.toLowerCase().trim() || null;
  const hasSpecificRequest = Boolean(materialNorm || colorNorm);

  const filtered = entries.filter(
    (e) =>
      (materialNorm && tagMatches(e.material, materialNorm)) || (colorNorm && tagMatches(e.color, colorNorm))
  );
  const specificRequestMatchedNothing = hasSpecificRequest && filtered.length === 0;
  const relevant = filtered.length > 0 ? filtered : entries;

  const groups = new Map<string, string[]>();
  for (const entry of relevant) {
    const list = groups.get(entry.design_code) ?? [];
    list.push(entry.image_url);
    groups.set(entry.design_code, list);
  }

  return {
    groups: Array.from(groups.entries()).map(([designCode, imageUrls]) => ({ designCode, imageUrls })),
    specificRequestMatchedNothing,
  };
}

// Same lesson as payment-method and design-code picking elsewhere in
// webhook.ts: don't rely on the model's own material/color extraction
// alone -- it can miss a plain, unambiguous answer like "Cotton Viscose"
// even though it's an exact (or near-exact) match against a real catalog
// tag. Only called as a fallback when the AI extracted neither, so it
// never overrides a real extraction, just catches what it missed.
export async function resolveMaterialOrColorFromText(
  topic: string,
  text: string
): Promise<{ material: string | null; color: string | null }> {
  const { data } = await supabase
    .from('design_catalog')
    .select('material, color')
    .eq('product_topic', topic)
    .eq('is_active', true);

  const entries = (data ?? []) as { material: string | null; color: string | null }[];
  const materials = [...new Set(entries.map((e) => e.material).filter((m): m is string => Boolean(m)))];
  const colors = [...new Set(entries.map((e) => e.color).filter((c): c is string => Boolean(c)))];

  const textNorm = text.toLowerCase();
  const material = materials.find((m) => textNorm.includes(m.toLowerCase())) ?? null;
  const color = colors.find((c) => textNorm.includes(c.toLowerCase())) ?? null;

  return { material, color };
}

export interface DesignBatch {
  groups: DesignGroup[];
  hasMore: boolean;
  specificRequestMatchedNothing: boolean;
}

// Case-insensitive, tolerant of partial matches in either direction (the
// customer's free-text preference vs. the owner's free-text tag on each
// design) -- e.g. customer says "pastel" and a design is tagged "Pastel
// Pink". Falls back to every active design for the topic if nothing
// matches, rather than showing the customer nothing at all.
//
// alreadyShownCodes excludes codes the customer has already been shown (in
// an earlier batch this same conversation) so "show me more" advances
// through the catalog instead of repeating itself.
export async function getNextDesignBatch(
  topic: string,
  material: string | null,
  color: string | null,
  alreadyShownCodes: string[]
): Promise<DesignBatch> {
  const { groups: all, specificRequestMatchedNothing } = await groupsForTopic(topic, material, color);
  const shown = new Set(alreadyShownCodes);
  const remaining = all.filter((g) => !shown.has(g.designCode));

  return {
    groups: remaining.slice(0, DESIGN_BATCH_SIZE),
    hasMore: remaining.length > DESIGN_BATCH_SIZE,
    specificRequestMatchedNothing,
  };
}

// WhatsApp's native "reply" gesture (swipe/long-press on a specific
// message) is how customers naturally pick a design after being shown
// several -- Meta's webhook payload includes `context.id`, the wa_message_id
// of the exact message being replied to, when a customer does this. That's
// a hard signal (they tapped/swiped that literal photo), stronger than
// either text matching or the AI's own guess from conversation context, so
// callers should try this first when it's available. Returns null whenever
// there's nothing to resolve (no reply, replied to something that wasn't a
// design photo, etc.) rather than throwing -- this is one signal among a
// few, not the only path to picking a design.
export async function resolveQuotedDesignCode(repliedToWaMessageId: string | null): Promise<string | null> {
  if (!repliedToWaMessageId) return null;

  const { data: repliedMessage } = await supabase
    .from('messages')
    .select('media_url')
    .eq('wa_message_id', repliedToWaMessageId)
    .maybeSingle();
  if (!repliedMessage?.media_url) return null;

  const { data: designRow } = await supabase
    .from('design_catalog')
    .select('design_code')
    .eq('image_url', repliedMessage.media_url)
    .maybeSingle();

  return designRow?.design_code ?? null;
}
