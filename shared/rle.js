// Shared FixCV helper (Node + browser): COCO RLE -> row-major raster.
// New work, 2026-10-28.

/**
 * Decode a COCO RLE mask ({size:[height,width], counts}, column-major,
 * counts alternate 0-run/1-run starting with 0s) into row-major 0/1 bytes.
 * @returns {{data: Uint8Array, width: number, height: number}}
 */
export function decodeRleToRaster(rle) {
  const [height, width] = rle.size;
  const out = new Uint8Array(width * height);
  let i = 0; // position in column-major order
  let value = 0;
  for (const run of rle.counts) {
    for (let k = 0; k < run; k++, i++) {
      const x = Math.floor(i / height);
      const y = i % height;
      if (x < width) out[y * width + x] = value;
    }
    value = value ? 0 : 1;
  }
  return { data: out, width, height };
}
