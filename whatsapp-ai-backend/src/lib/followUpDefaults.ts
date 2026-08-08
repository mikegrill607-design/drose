import { AppSettingKey } from '../types';

export type FollowUpKey =
  | 'followup_day1_ms'
  | 'followup_day1_en'
  | 'followup_day3_ms'
  | 'followup_day3_en'
  | 'followup_day7_ms'
  | 'followup_day7_en';

// Fallback text used until the owner customizes each stage from the
// dashboard (Configure -> Follow-Up Messages). Shared between
// routes/settings.ts (so GET returns something sensible before first save)
// and cron/followUp.ts (so a missing key never sends a blank message).
export const FOLLOW_UP_DEFAULTS: Record<FollowUpKey, string> = {
  followup_day1_ms: 'Hai! Masih berminat dengan koleksi kami? Kami boleh bantu carikan yang sesuai 😊',
  followup_day1_en: 'Hi! Still interested in our collection? Happy to help you find the right piece 😊',
  followup_day3_ms: 'Hai lagi! Jangan lupa koleksi eksklusif kami -- kebanyakan design cuma ada satu helai je.',
  followup_day3_en: "Just checking in! Don't forget our exclusive pieces -- most designs only have one available.",
  followup_day7_ms: 'Last reminder ya -- kalau berminat lagi boleh terus mesej kami bila-bila masa 🙏',
  followup_day7_en: 'Last reminder -- feel free to message us anytime if you change your mind 🙏',
};

export const FOLLOW_UP_KEYS: AppSettingKey[] = [
  'followup_day1_ms',
  'followup_day1_en',
  'followup_day3_ms',
  'followup_day3_en',
  'followup_day7_ms',
  'followup_day7_en',
];
