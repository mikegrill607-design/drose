import { supabase } from './supabase';
import { AppSettingKey } from '../types';

/**
 * WhatsApp Business credentials live in `app_settings`, not env vars, so
 * staff can reconnect the account from the dashboard without a redeploy.
 * Always fetched fresh so a settings change is picked up on the very next
 * webhook message, no matter how recently it was last read.
 */
export async function getAppSettings(): Promise<Partial<Record<AppSettingKey, string>>> {
  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error) throw error;

  const values: Partial<Record<AppSettingKey, string>> = {};
  for (const row of data ?? []) {
    values[row.key as AppSettingKey] = row.value;
  }
  return values;
}
