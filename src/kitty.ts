// Kitty graphics encoding, ported from gum-org/gum-jsx-node/src/term.ts (MIT).
type KittyOptions = Readonly<{
  image_id?: number;
  placement_id?: number;
  chunk_size?: number;
  columns?: number;
  rows?: number;
  cursor_movement?: boolean;
  virtual?: boolean;
}>;
type PixelSize = Readonly<{ width: number; height: number }>;

// Encode complete image data before chunking; only the first packet carries
// image metadata. Continuations carry m=1 until the final packet's m=0.
function format_data(data: Buffer | string, format: 100 | 32,
  options: KittyOptions, size?: PixelSize): string {
  const { image_id, placement_id, columns, rows, cursor_movement = true,
    virtual = false, chunk_size = 4096 } = options;
  if (!Number.isInteger(chunk_size) || chunk_size < 4 || chunk_size > 4096
    || chunk_size % 4 !== 0) {
    throw new RangeError('chunk_size must be a multiple of 4 between 4 and 4096');
  }

  const header = [`f=${format}`, 'a=T', 'q=1'];
  const fields = { s: size?.width, v: size?.height, i: image_id,
    p: placement_id, c: columns, r: rows };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
      throw new RangeError(`Kitty ${key} must be a positive 32-bit integer`);
    }
    header.push(`${key}=${value}`);
  }
  if (!cursor_movement) header.push('C=1');
  if (virtual) header.push('U=1');

  const base64 = typeof data === 'string' ? data : data.toString('base64');
  const packets: string[] = [];
  for (let offset = 0; offset < base64.length; offset += chunk_size) {
    const chunk = base64.slice(offset, offset + chunk_size);
    const more = offset + chunk_size < base64.length ? 1 : 0;
    const control = offset === 0 ? [...header, `m=${more}`].join(',') : `m=${more}`;
    packets.push(`\x1b_G${control};${chunk}\x1b\\`);
  }
  return packets.join('');
}

function format_image(png: Buffer | string, options: KittyOptions = {}): string {
  return format_data(png, 100, options);
}

function format_pixels(pixels: Buffer | string, size: PixelSize,
  options: KittyOptions = {}): string {
  return format_data(pixels, 32, options, size);
}

export { format_image, format_pixels };
export type { KittyOptions };
