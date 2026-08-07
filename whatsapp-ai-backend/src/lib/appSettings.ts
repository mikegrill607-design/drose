import { supabase } from './supabase';
import { AppSettingKey } from '../types';

interface CacheEntry {
  values: Partial<Record<AppSettingKey, string>>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

/**
 * WhatsApp Business credentials live in `app_settings`, not env vars, so
 * staff can reconnect the account from the dashboard without a redeploy.
 * Cached briefly to avoid a DB round trip on every webhook message.
 */
export async function getAppSettings(): Promise<Partial<Record<AppSettingKey, string>>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.values;
  }

  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error) throw error;

  const values: Partial<Record<AppSettingKey, string>> = {};
  for (const row of data ?? []) {
    values[row.key as AppSettingKey] = row.value;
  }

  cache = { values, fetchedAt: Date.now() };
  return values;
}

export function invalidateAppSettingsCache(): void {
  cache = null;
}
