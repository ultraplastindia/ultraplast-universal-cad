/** True when the first bytes of the file really are the picture type that was claimed (JPEG, PNG or WebP).
 *  A file renamed to .png but containing something else is refused. `b64` is the base64 text of the file. */
export function imageMatches(mime: string, b64: string): boolean {
  const head = Buffer.from(b64.slice(0, 32), 'base64');
  if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}
