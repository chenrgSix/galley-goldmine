declare module "gifenc" {
  type Palette = number[][];

  const gifenc: {
    GIFEncoder(): {
      writeFrame(indices: Uint8Array, width: number, height: number, options: {
        palette: Palette; delay: number; repeat: number;
      }): void;
      finish(): void;
      bytes(): Uint8Array;
    };
    quantize(pixels: Uint8Array, maxColors: number): Palette;
    applyPalette(pixels: Uint8Array, palette: Palette): Uint8Array;
  };

  export default gifenc;
}
