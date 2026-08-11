-- Size chart reference images -- a simpler, separate mechanism from
-- design_catalog: no "pick a code" step, just a fixed set of images (e.g.
-- short sleeve / long sleeve measurement charts) sent once automatically
-- when a customer shows interest in a product that has one, so they can
-- reference exact measurements while telling the AI their size.
create table size_chart_images (
  id uuid primary key default gen_random_uuid(),
  product_topic text not null, -- matches knowledge_base.topic
  label text, -- optional caption, e.g. "Short Sleeve" / "Long Sleeve"
  image_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index size_chart_images_topic_idx on size_chart_images (product_topic);
alter table size_chart_images enable row level security;
create policy "authenticated read size_chart_images" on size_chart_images for select to authenticated using (true);

-- Dedupes the auto-send so the chart only goes out once per conversation.
alter table conversations add column if not exists sent_size_chart boolean not null default false;
