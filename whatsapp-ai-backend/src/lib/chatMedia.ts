import sharp from 'sharp';
import { supabase } from './supabase';

const BUCKET = 'chat-media';

// Every image in this bucket is served to Meta on every WhatsApp send (via
// URL link, not a one-time upload) and stored forever for customer-sent
// photos -- both bandwidth and storage on the free Supabase tier scale with
// file size, so large phone-camera photos are worth shrinking before they
// land in the bucket.
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Skip already-small images (most staff-uploaded QR codes and size charts
// land well under this) -- re-encoding them risks softening fine detail
// like QR modules for negligible size savings.
const SKIP_BELOW_BYTES = 300 * 1024;
// Plenty for how WhatsApp actually displays chat images; cuts multi-MB
// phone-camera photos down sharply without a visible quality loss in-app.
const MAX_DIMENSION = 1600;

async function compressImage(buffer: Buffer, contentType: string): Promise<Buffer> {
  if (!COMPRESSIBLE_TYPES.has(contentType) || buffer.length <= SKIP_BELOW_BYTES) {
    return buffer;
  }

  try {
    const pipeline = sharp(buffer).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const compressed =
      contentType === 'image/png'
        ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : contentType === 'image/webp'
          ? await pipeline.webp({ quality: 80 }).toBuffer()
          : await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();

    // A handful of already-optimized images can come back slightly larger
    // after re-encoding -- only use the compressed version when it helps.
    return compressed.length < buffer.length ? compressed : buffer;
  } catch (err) {
    console.error('Image compression failed, uploading original:', err instanceof Error ? err.message : err);
    return buffer;
  }
}

// Called once at startup. Idempotent -- Supabase returns an error if the
// bucket already exists, which is expected on every boot after the first.
export async function ensureChatMediaBucket(): Promise<void> {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    console.error('Failed to ensure chat-media bucket exists:', error.message);
  }
}

// Route handlers build storage paths as `${prefix}/${Date.now()}-${originalname}`
// straight from the uploaded file's client-supplied name -- strip anything
// that isn't a safe filename character so a crafted name (e.g. containing
// "../" or a null byte) can't land outside the intended folder or collide
// with an unrelated object in the bucket.
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

export async function uploadChatMedia(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const finalBuffer = await compressImage(buffer, contentType);

  const { error } = await supabase.storage.from(BUCKET).upload(path, finalBuffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
