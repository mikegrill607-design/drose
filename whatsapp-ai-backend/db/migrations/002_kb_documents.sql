-- Run this once in the Supabase SQL editor to switch the knowledge base from
-- manual topic/question/answer_ms/answer_en rows to one uploaded-PDF document
-- per category (topic), with an optional keyword list to help the AI's
-- keyword router match different customer phrasings to the right category.
alter table knowledge_base add column if not exists content text;
alter table knowledge_base add column if not exists keywords text; -- comma-separated aliases, e.g. "baju,shirt,lelaki"
alter table knowledge_base add column if not exists source_filename text;

update knowledge_base set content = coalesce(content, answer_en, answer_ms, '') where content is null;

alter table knowledge_base alter column content set not null;
alter table knowledge_base drop column if exists question;
alter table knowledge_base drop column if exists answer_ms;
alter table knowledge_base drop column if exists answer_en;

-- One document per category -- re-uploading the same topic replaces it
-- rather than creating a duplicate.
alter table knowledge_base add constraint knowledge_base_topic_unique unique (topic);
