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

-- Knowledge base: one document per category (topic). content holds both BM
-- and EN copy in one blob -- the AI translates/replies in whichever language
-- it detects, it doesn't need a pre-split column per language (spec Section 4.1).
-- keywords widens what customer phrasing matches this category (see
-- src/lib/kbRouter.ts) beyond what's literally in the topic name.
insert into knowledge_base (topic, keywords, content, is_active) values
(
  'product_kemeja_daniel_rose',
  'kemeja,baju lelaki,men shirt,shirt,daniel rose,danielrose',
  $$Nama Produk: Kemeja Batik Cotton DanielRose / Product Name: Kemeja Batik Cotton DanielRose
Brand: DanielRose
Kategori: Kemeja Batik Lelaki / Category: Men's Batik Shirt
Material: Cotton Lining
Potongan: Regular Cut / Cut: Regular cut
Jenis: Short Sleeve & Long Sleeve / Type: Short sleeve & long sleeve
Harga Short Sleeve: RM159 / Short sleeve price: RM159
Harga Long Sleeve: RM199 / Long sleeve price: RM199

Ciri-ciri / Features:
- Batik lukisan tangan. / Hand-drawn batik.
- Setiap corak adalah eksklusif. / Every pattern is exclusive.
- Konsep One Design, One Owner -- kebanyakan design hanya tersedia satu helai. / "One Design, One Owner" concept -- most designs only have a single piece available.
- Material cotton lining yang selesa dipakai dan tidak panas. / Comfortable cotton lining material, not hot to wear.
- Sesuai untuk kerja, majlis, hadiah atau pakaian harian. / Suitable for work, events, gifts, or everyday wear.
- Boleh dicuci menggunakan mesin atau tangan. / Machine or hand washable.
- Setiap pembelian disertakan kotak dan riben. / Every purchase comes with a box and ribbon.$$,
  true
),
(
  'product_kain_pasang',
  'kain pasang,kain batik,fabric,batik fabric,kain',
  $$Nama Produk: Kain Pasang Batik 4 Meter / Product Name: Kain Pasang Batik 4 Meter
Brand: D'ROSE Batik
Panjang: 4 meter / Length: 4 meters
Kategori: Kain Batik Wanita / Category: Women's batik fabric
Material: Bergantung kepada koleksi seperti Crepe Silk dan Cotton Viscose. / Material: Depends on collection, e.g. Crepe Silk and Cotton Viscose.
Rekaan: Batik lukisan tangan. / Design: Hand-drawn batik.

Ciri-ciri / Features:
- Panjang kain 4 meter. / 4-meter fabric length.
- Sesuai dibuat baju kurung, kebaya, dress atau rekaan mengikut citarasa pelanggan. / Suitable for baju kurung, kebaya, dresses, or custom designs.
- Terdapat pelbagai pilihan warna dan corak. / Various colors and patterns available.
- Kebanyakan design hanya satu helai. / Most designs only have a single piece available.
- Rekaan eksklusif D'ROSE dengan hasil lukisan tangan. / Exclusive D'ROSE hand-drawn design.
- Harga bergantung kepada material dan koleksi. / Price depends on material and collection.$$,
  true
),
(
  'product_kaftan_lovelies',
  'kaftan,lovelies,kaftan cotton',
  'TODO: confirm with owner -- Kaftan Cotton Lovelies copy pending (spec Section 4.1 note). Not yet marked active.',
  false
)
on conflict (topic) do update set keywords = excluded.keywords, content = excluded.content, is_active = excluded.is_active;

-- Non-product topics (spec Section 4.3) -- all pending owner confirmation.
insert into knowledge_base (topic, keywords, content, is_active) values
('shipping', 'hantar,shipping,delivery,poslaju,penghantaran', '[TODO: confirm with owner]', false),
('payment_methods', 'bayar,payment,bank transfer,tng,ewallet,duitnow', '[TODO: confirm with owner]', false),
('returns', 'tukar,return,exchange,refund,pulang', '[TODO: confirm with owner]', false),
('how_to_order', 'order,macam mana nak order,how to order,cara order', '[TODO: confirm with owner]', false),
('brand_story', 'brand,cerita,history,tentang,about', '[TODO: confirm with owner]', false),
('delivery_time', 'berapa lama,how long,delivery time,tempoh', '[TODO: confirm with owner]', false),
('custom_orders', 'custom,tempahan khas,customize', '[TODO: confirm with owner]', false)
on conflict (topic) do update set keywords = excluded.keywords, content = excluded.content, is_active = excluded.is_active;
