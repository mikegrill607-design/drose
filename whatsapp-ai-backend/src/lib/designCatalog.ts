import { supabase } from './supabase';
import { DesignCatalogEntry } from '../types';

// A "New handoff" storm of 15+ images in one WhatsApp message would be a
// bad customer experience and a lot of wasted media-message cost -- cap how
// many distinct design codes get sent at once. Each code can still bring
// its own 2-3 photos.
const MAX_DESIGN_CODES_PER_SEND = 5;

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

// Case-insensitive, tolerant of partial matches in either direction (the
// customer's free-text preference vs. the owner's free-text tag on each
// design) -- e.g. customer says "pastel" and a design is tagged "Pastel
// Pink". Falls back to every active design for the topic if nothing
// matches, rather than showing the customer nothing at all.
export async function getMatchingDesignGroups(
  topic: string,
  material: string | null,
  color: string | null
): Promise<DesignGroup[]> {
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

  return Array.from(groups.entries())
    .slice(0, MAX_DESIGN_CODES_PER_SEND)
    .map(([designCode, imageUrls]) => ({ designCode, imageUrls }));
}
