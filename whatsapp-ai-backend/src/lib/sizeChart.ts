import { supabase } from './supabase';
import { SizeChartImage } from '../types';

export async function getSizeChartImages(topic: string): Promise<SizeChartImage[]> {
  const { data } = await supabase
    .from('size_chart_images')
    .select('*')
    .eq('product_topic', topic)
    .eq('is_active', true)
    .order('created_at');
  return (data ?? []) as SizeChartImage[];
}
