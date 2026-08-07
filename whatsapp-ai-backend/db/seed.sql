-- Re-runnable seed data. Real product copy is from the spec (whatsapp-ai-engine-spec.md
-- Section 4.1); everything marked TODO still needs owner confirmation (spec Section 12)
-- and can be edited afterwards from the dashboard -- no code changes needed.
--
-- No system_prompt row here -- write the initial prompt from the dashboard's
-- System Prompt page instead. Until one exists, src/lib/ai.ts falls back to a
-- generic default so the webhook doesn't error.

-- Placeholder staff row -- real name/number set from the dashboard Settings page.
insert into staff (name, whatsapp_number)
values ('TODO: set staff name', 'TODO_SET_IN_SETTINGS');

-- Knowledge base: product entries (verbatim from spec Section 4.1)
insert into knowledge_base (topic, question, answer_ms, answer_en, is_active) values
(
  'product_kemeja_daniel_rose',
  'Kemeja lelaki ada?',
  $$Nama Produk: Kemeja Batik Cotton DanielRose
Brand: DanielRose
Kategori: Kemeja Batik Lelaki
Material: Cotton Lining
Potongan: Regular Cut
Jenis: Short Sleeve & Long Sleeve
Harga Short Sleeve: RM159
Harga Long Sleeve: RM199

Ciri-ciri:
- Batik lukisan tangan.
- Setiap corak adalah eksklusif.
- Konsep One Design, One Owner -- kebanyakan design hanya tersedia satu helai.
- Material cotton lining yang selesa dipakai dan tidak panas.
- Sesuai untuk kerja, majlis, hadiah atau pakaian harian.
- Boleh dicuci menggunakan mesin atau tangan.
- Setiap pembelian disertakan kotak dan riben.$$,
  $$Product Name: Kemeja Batik Cotton DanielRose
Brand: DanielRose
Category: Men's Batik Shirt
Material: Cotton lining
Cut: Regular cut
Type: Short sleeve & long sleeve
Short sleeve price: RM159
Long sleeve price: RM199

Features:
- Hand-drawn batik.
- Every pattern is exclusive.
- "One Design, One Owner" concept -- most designs only have a single piece available.
- Comfortable cotton lining material, not hot to wear.
- Suitable for work, events, gifts, or everyday wear.
- Machine or hand washable.
- Every purchase comes with a box and ribbon.$$,
  true
),
(
  'product_kain_pasang',
  'Ada kain pasang batik?',
  $$Nama Produk: Kain Pasang Batik 4 Meter
Brand: D'ROSE Batik
Panjang: 4 meter
Kategori: Kain Batik Wanita
Material: Bergantung kepada koleksi seperti Crepe Silk dan Cotton Viscose.
Rekaan: Batik lukisan tangan.

Ciri-ciri:
- Panjang kain 4 meter.
- Sesuai dibuat baju kurung, kebaya, dress atau rekaan mengikut citarasa pelanggan.
- Terdapat pelbagai pilihan warna dan corak.
- Kebanyakan design hanya satu helai.
- Rekaan eksklusif D'ROSE dengan hasil lukisan tangan.
- Harga bergantung kepada material dan koleksi.$$,
  $$Product Name: Kain Pasang Batik 4 Meter
Brand: D'ROSE Batik
Length: 4 meters
Category: Women's batik fabric
Material: Depends on collection, e.g. Crepe Silk and Cotton Viscose.
Design: Hand-drawn batik.

Features:
- 4-meter fabric length.
- Suitable for baju kurung, kebaya, dresses, or custom designs.
- Various colors and patterns available.
- Most designs only have a single piece available.
- Exclusive D'ROSE hand-drawn design.
- Price depends on material and collection.$$,
  true
),
(
  'product_kaftan_lovelies',
  'Ada kaftan?',
  'TODO: confirm with owner -- Kaftan Cotton Lovelies copy pending (spec Section 4.1 note). Not yet marked active.',
  'TODO: confirm with owner -- Kaftan Cotton Lovelies copy pending.',
  false
);

-- Non-product topics (spec Section 4.3) -- all pending owner confirmation.
insert into knowledge_base (topic, question, answer_ms, answer_en, is_active) values
('shipping', 'Boleh hantar ke seluruh Malaysia?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('payment_methods', 'Macam mana nak bayar?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('returns', 'Boleh tukar kalau tak muat?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('how_to_order', 'Macam mana nak order?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('brand_story', 'Ni brand apa?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('delivery_time', 'Berapa lama sampai?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false),
('custom_orders', 'Boleh order custom?', '[TODO: confirm with owner]', '[TODO: confirm with owner]', false);
