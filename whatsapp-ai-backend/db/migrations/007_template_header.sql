-- Run this once in the Supabase SQL editor. Adds the optional header line
-- Meta's own template form supports (separate from body, its own single
-- {{1}} variable if used -- header and body variables are numbered
-- independently per Meta's component model).
alter table whatsapp_templates add column if not exists header_text text;
alter table whatsapp_templates add column if not exists header_example text;
