import { Message } from '../types';

/**
 * Handoff trigger = customer has given a full qualifying combo needed to
 * search real stock (spec Section 4.2/6) -- not a single keyword like
 * "price" or "size" mentioned in passing. Generic across every product in
 * the Knowledge Base (not hardcoded per product name) -- a size/fit detail
 * PLUS a variant detail (color or material), given anywhere across the
 * conversation's customer messages, is what search-real-stock requests
 * actually look like for this catalog (sleeve+size for shirts, color+material
 * for fabric/kaftan, etc.). Which specific product it's about is inferred
 * separately in webhook.ts via the same KB keyword router used for AI
 * replies, not tracked here.
 */
const SIZE_OR_FIT_PATTERNS: RegExp[] = [
  /\b(xs|s|m|l|xl|xxl|xxxl)\b/i,
  /\bsaiz\s*\w+/i,
  /short\s*sleeve/i,
  /long\s*sleeve/i,
  /lengan\s*pendek/i,
  /lengan\s*panjang/i,
];

const VARIANT_PATTERNS: RegExp[] = [
  /\bwarna\s*\w+/i,
  /\b(red|blue|green|black|white|merah|biru|hijau|hitam|putih|pastel)\b/i,
  /crepe\s*silk/i,
  /cotton\s*viscose/i,
  /\bmaterial\b/i,
  /\bbahan\b/i,
];

export interface IntentResult {
  qualifyingComboMet: boolean;
  matchedDetails: string[];
}

/**
 * Checks whether, across the conversation's customer messages, both a
 * size/fit detail and a variant detail have now been given.
 */
export function checkQualifyingCombo(customerMessages: Message[]): IntentResult {
  const combinedText = customerMessages.map((m) => m.content).join(' \n ');

  const sizeMatch = SIZE_OR_FIT_PATTERNS.map((p) => combinedText.match(p)?.[0]).find(Boolean);
  const variantMatch = VARIANT_PATTERNS.map((p) => combinedText.match(p)?.[0]).find(Boolean);

  if (sizeMatch && variantMatch) {
    return { qualifyingComboMet: true, matchedDetails: [sizeMatch, variantMatch] };
  }
  return { qualifyingComboMet: false, matchedDetails: [] };
}
