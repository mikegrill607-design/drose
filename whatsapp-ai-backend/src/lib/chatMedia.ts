import { supabase } from './supabase';

const BUCKET = 'chat-media';

// Called once at startup. Idempotent -- Supabase returns an error if the
// bucket already exists, which is expected on every boot after the first.
export async function ensureChatMediaBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    console.error('Failed to ensure chat-media bucket exists:', error.message);
  }
}

export async function uploadChatMedia(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
