import { supabase } from './supabase';
import { PaymentMethod } from '../types';

export async function getActivePaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await supabase.from('payment_methods').select('*').eq('is_active', true).order('method_name');
  return (data ?? []) as PaymentMethod[];
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Case-insensitive, whitespace-insensitive, tolerant of partial matches --
// same approach as design_catalog's material/color matching, since
// customers name a bank in all kinds of casual phrasing ("maybank",
// "may bank", "mae bank", "bank islam"). Stripping whitespace matters here
// specifically because "MAYBANK" is stored with no internal space, but a
// customer typing it naturally very often adds one ("may bank") -- a plain
// substring check misses that entirely.
export async function findPaymentMethod(customerAnswer: string): Promise<PaymentMethod | null> {
  const methods = await getActivePaymentMethods();
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const needle = normalize(customerAnswer);
  if (!needle) return null;

  const substringMatch = methods.find((m) => {
    const name = normalize(m.method_name);
    return name.includes(needle) || needle.includes(name);
  });
  if (substringMatch) return substringMatch;

  // Catches genuine misspellings ("maybannk" for "maybank") the substring
  // check above can't -- only tried when the reply is roughly the same
  // length as the bank name itself (a short, direct answer to "which
  // bank?"), so a longer unrelated sentence never gets force-matched to
  // whichever name happens to be closest.
  return (
    methods.find((m) => {
      const name = normalize(m.method_name);
      if (Math.abs(needle.length - name.length) > 2) return false;
      const maxDistance = name.length <= 5 ? 1 : 2;
      return levenshtein(needle, name) <= maxDistance;
    }) ?? null
  );
}
