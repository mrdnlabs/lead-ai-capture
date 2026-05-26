import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export const AUDIO_BUCKET = 'capture-audio';
export const PHOTO_BUCKET = 'capture-photos';

const AUDIO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

const PHOTO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

function extFor(map: Record<string, string>, mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return map[base] ?? 'bin';
}

export function audioKey(showId: string, repId: string, captureId: string, mime: string): string {
  return `${showId}/${repId}/${captureId}.${extFor(AUDIO_EXT, mime)}`;
}

export function photoKey(showId: string, repId: string, captureId: string, mime: string): string {
  return `${showId}/${repId}/${captureId}.${extFor(PHOTO_EXT, mime)}`;
}

export async function uploadBlob(args: {
  bucket: string;
  key: string;
  file: File | Blob;
  contentType: string;
}): Promise<{ size: number }> {
  const supabase = await createSupabaseServiceRoleClient();
  const { error } = await supabase.storage.from(args.bucket).upload(args.key, args.file, {
    contentType: args.contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed (${args.bucket}/${args.key}): ${error.message}`);
  return { size: args.file.size };
}

export async function signedDownloadUrl(args: {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const supabase = await createSupabaseServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(args.bucket)
    .createSignedUrl(args.key, args.expiresInSeconds ?? 3600);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}
