import { supabase } from './supabase';
import { PaymentMethod } from '../types';

export async function getActivePaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await supabase.from('payment_methods').select('*').eq('is_active', true).order('method_name');
  return (data ?? []) as PaymentMethod[];
}

// Case-insensitive, tolerant of partial matches -- same approach as
// design_catalog's material/color matching, since customers name a bank in
// all kinds of casual phrasing ("maybank", "mae bank", "bank islam").
export async function findPaymentMethod(customerAnswer: string): Promise<PaymentMethod | null> {
  const methods = await getActivePaymentMethods();
  const needle = customerAnswer.toLowerCase().trim();
  if (!needle) return null;

  return (
    methods.find((m) => {
      const name = m.method_name.toLowerCase();
      return name.includes(needle) || needle.includes(name);
    }) ?? null
  );
}
