import { DetectedLanguage } from '../types';

// Common Bahasa Melayu function words / markers that rarely appear in English
// chat text. Heuristic, not a full language model -- good enough to pick the
// right knowledge-base column and system-prompt instruction.
const BM_MARKERS = [
  'saya', 'awak', 'kak', 'boleh', 'nak', 'tak', 'tidak', 'ada', 'macam',
  'mana', 'ni', 'ini', 'itu', 'yang', 'dengan', 'untuk', 'daripada',
  'berapa', 'harga', 'saiz', 'warna', 'lengan', 'baju', 'kain', 'hantar',
  'bayar', 'tolong', 'terima', 'kasih', 'sila', 'boleh', 'nk', 'sy',
];

export function detectLanguage(text: string): DetectedLanguage {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'ms'; // primary language default, per spec

  const bmHits = words.filter((w) => BM_MARKERS.includes(w)).length;
  const bmRatio = bmHits / words.length;

  // Bias toward BM (the brand's primary language) unless the text reads
  // clearly as English.
  return bmRatio > 0 || words.length < 3 ? 'ms' : 'en';
}
