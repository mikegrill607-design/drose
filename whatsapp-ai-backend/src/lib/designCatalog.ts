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

async function groupsForTopic(topic: string, material: string | null, color: string | null): Promise<DesignGroup[]> {
  const { data } = await supabase
    .from('design_catalog')
    .select('*')
    .eq('product_topic', topic)
    .eq('is_active', true)
    .order('design_code');

  const entries = (data ?? []) as DesignCatalogEntry[];
  const materialNorm = material?.toLowerCase().trim() || null;
  const colorNorm = color?.toLowerCase().trim() || null;

  const filtered = entries.filter(
    (e) =>
      (materialNorm && tagMatches(e.material, materialNorm)) || (colorNorm && tagMatches(e.color, colorNorm))
  );
  const relevant = filtered.length > 0 ? filtered : entries;

  const groups = new Map<string, string[]>();
  for (const entry of relevant) {
    const list = groups.get(entry.design_code) ?? [];
    list.push(entry.image_url);
    groups.set(entry.design_code, list);
  }

  return Array.from(groups.entries()).map(([designCode, imageUrls]) => ({ designCode, imageUrls }));
}

export interface DesignBatch {
  groups: DesignGroup[];
  hasMore: boolean;
}

// Most designs are one-of-a-kind ("One Design, One Owner" -- see Knowledge
// Base) -- once a customer actually commits to buying one (reaches the
// payment step), it needs to stop being offered to anyone else immediately,
// not whenever staff happen to notice and update it by hand. Staff can
// still reactivate it manually from the Design Catalog page if the sale
// falls through.
export async function deactivateDesign(topic: string, designCode: string): Promise<void> {
  const { error } = await supabase
    .from('design_catalog')
    .update({ is_active: false })
    .eq('product_topic', topic)
    .eq('design_code', designCode);
  if (error) console.error('Failed to deactivate sold design', topic, designCode, error);
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
  const all = await groupsForTopic(topic, material, color);
  const shown = new Set(alreadyShownCodes);
  const remaining = all.filter((g) => !shown.has(g.designCode));

  return {
    groups: remaining.slice(0, DESIGN_BATCH_SIZE),
    hasMore: remaining.length > DESIGN_BATCH_SIZE,
  };
}
