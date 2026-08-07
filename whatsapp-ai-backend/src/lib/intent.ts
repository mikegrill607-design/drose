import { Message } from '../types';

/**
 * Handoff trigger = customer has given the FULL qualifying combo needed to
 * search real stock (spec Section 4.2/6) -- not a single keyword like
 * "price" or "size" mentioned in passing. Each product defines the slots
 * that must ALL be filled (from any customer message in the conversation,
 * not just the latest one) before we flip to `awaiting_staff`.
 *
 * TODO: confirm exact qualifying slots per product with the owner --
 * Kaftan Cotton Lovelies copy (and its slots) is still pending (spec 4.1 note).
 */
interface ProductSlotConfig {
  product: string;
  slots: {
    name: string;
    patterns: RegExp[];
  }[];
}

const PRODUCT_CONFIGS: ProductSlotConfig[] = [
  {
    product: 'Kemeja Batik Cotton DanielRose',
    slots: [
      { name: 'sleeve_type', patterns: [/short\s*sleeve/i, /long\s*sleeve/i, /lengan\s*pendek/i, /lengan\s*panjang/i] },
      { name: 'size', patterns: [/\b(xs|s|m|l|xl|xxl|xxxl)\b/i, /\bsaiz\s*\w+/i] },
    ],
  },
  {
    product: 'Kain Pasang Batik 4 Meter',
    slots: [
      { name: 'material', patterns: [/crepe\s*silk/i, /cotton\s*viscose/i, /\bmaterial\b/i, /\bbahan\b/i] },
      { name: 'color', patterns: [/\bwarna\s*\w+/i, /\b(red|blue|green|black|white|merah|biru|hijau|hitam|putih|pastel)\b/i] },
    ],
  },
];

export interface IntentResult {
  qualifyingComboMet: boolean;
  matchedProduct: string | null;
  matchedDetails: string[];
}

/**
 * Checks whether, across the conversation's customer messages, ALL slots for
 * any one product have now been satisfied.
 */
export function checkQualifyingCombo(customerMessages: Message[]): IntentResult {
  const combinedText = customerMessages.map((m) => m.content).join(' \n ');

  for (const config of PRODUCT_CONFIGS) {
    const matchedDetails: string[] = [];
    let allSlotsFilled = true;

    for (const slot of config.slots) {
      const hit = slot.patterns.some((p) => p.test(combinedText));
      if (!hit) {
        allSlotsFilled = false;
        break;
      }
      const match = slot.patterns.map((p) => combinedText.match(p)?.[0]).find(Boolean);
      if (match) matchedDetails.push(match);
    }

    if (allSlotsFilled) {
      return { qualifyingComboMet: true, matchedProduct: config.product, matchedDetails };
    }
  }

  return { qualifyingComboMet: false, matchedProduct: null, matchedDetails: [] };
}
