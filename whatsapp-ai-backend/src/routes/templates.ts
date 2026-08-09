import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { createMessageTemplate } from '../lib/whatsappTemplates';

export const templatesRouter = Router();

templatesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('whatsapp_templates').select('*').order('created_at', { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

// Slug-ify to Meta's required format: lowercase letters, digits, underscores only.
function toMetaSafeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Creates a DRAFT only -- doesn't touch Meta yet. Lets staff save work in
// progress and review before actually submitting for approval.
templatesRouter.post('/', async (req, res) => {
  const { name, language, category, headerText, headerExample, bodyText, variableExamples, footerText } =
    req.body ?? {};
  if (!name || !bodyText) {
    res.status(400).json({ error: 'name and bodyText are required' });
    return;
  }
  if (category && !['MARKETING', 'UTILITY'].includes(category)) {
    res.status(400).json({ error: 'category must be "MARKETING" or "UTILITY"' });
    return;
  }

  const { data, error } = await supabase
    .from('whatsapp_templates')
    .insert({
      name: toMetaSafeName(name),
      language: language || 'ms',
      category: category || 'MARKETING',
      header_text: headerText || null,
      header_example: headerExample || null,
      body_text: bodyText,
      variable_examples: Array.isArray(variableExamples) ? variableExamples : [],
      footer_text: footerText || null,
      status: 'draft',
    })
    .select('*')
    .single();

  if (error) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
});

// The step that actually requires Meta's approval -- submits the draft for
// review. Meta returns PENDING immediately; approval/rejection is async
// (see cron/templateStatus.ts, which polls since there's no webhook for it).
templatesRouter.post('/:id/submit', async (req, res) => {
  const { id } = req.params;

  const { data: template, error: fetchErr } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !template) {
    res.status(404).json({ error: 'template not found' });
    return;
  }

  try {
    const result = await createMessageTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      headerText: template.header_text,
      headerExample: template.header_example,
      bodyText: template.body_text,
      variableExamples: template.variable_examples ?? [],
      footerText: template.footer_text,
    });

    const { data, error } = await supabase
      .from('whatsapp_templates')
      .update({
        meta_template_id: result.metaTemplateId,
        status: result.status.toLowerCase(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'failed to submit template to Meta' });
  }
});

templatesRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('whatsapp_templates').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});
