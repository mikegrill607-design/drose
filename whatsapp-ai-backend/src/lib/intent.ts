import { Message } from '../types';

/**
 * Handoff trigger = customer has given a full qualifying combo needed to
 * search real stock (spec Section 4.2/6) -- not a single keyword like
 * "price" or "size" mentioned in passing. Generic across every product in
 * the Knowledge Base (not hardcoded per product name): four independent
 * attribute categories (size, sleeve/fit type, color, material), and the
 * trigger fires once the customer has given details from ANY two distinct
 * categories -- covers "short sleeve, size L" (size + sleeve, no
 * color/material at all) for shirts just as well as "crepe, warna pastel"
 * (material + color) for fabric/kaftan, without hardcoding per product name.
 * Which specific product it's about is inferred separately in webhook.ts via
 * the same KB keyword router used for AI replies, not tracked here.
 */
interface AttributeCategory {
  name: string;
  patterns: RegExp[];
}

const ATTRIBUTE_CATEGORIES: AttributeCategory[] = [
  { name: 'size', patterns: [/\b(xs|s|m|l|xl|xxl|xxxl)\b/i, /\bsaiz\s*\w+/i] },
  {
    name: 'sleeve/fit',
    patterns: [/short\s*sleeve/i, /long\s*sleeve/i, /lengan\s*pendek/i, /lengan\s*panjang/i],
  },
  {
    name: 'color',
    patterns: [/\bwarna\s*\w+/i, /\b(red|blue|green|black|white|merah|biru|hijau|hitam|putih|pastel)\b/i],
  },
  { name: 'material', patterns: [/crepe\s*silk/i, /cotton\s*viscose/i, /\bmaterial\b/i, /\bbahan\b/i] },
];

export interface IntentResult {
  qualifyingComboMet: boolean;
  matchedDetails: string[];
}

/**
 * Checks whether, across the conversation's customer messages, at least two
 * distinct attribute categories have been given.
 */
export function checkQualifyingCombo(customerMessages: Message[]): IntentResult {
  const combinedText = customerMessages.map((m) => m.content).join(' \n ');

  const matches = ATTRIBUTE_CATEGORIES.map((category) => ({
    name: category.name,
    match: category.patterns.map((p) => combinedText.match(p)?.[0]).find(Boolean),
  })).filter((m) => m.match);

  if (matches.length >= 2) {
    return {
      qualifyingComboMet: true,
      matchedDetails: matches.map((m) => `${m.name}: ${m.match}`),
    };
  }
  return { qualifyingComboMet: false, matchedDetails: [] };
}
