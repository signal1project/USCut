// Ambient types for `kokoro-js`.
//
// The package's package.json declares only a conditional `exports` map (no
// top-level `types`/`main` fallback), which this project's tsconfig
// `moduleResolution: "Node"` (classic) can't follow — real .d.ts files ship
// in the package but tsc can't find them. This declares just the slice of
// the API video/kokoroNarration.ts actually uses; switching the whole
// project to `moduleResolution: "bundler"`/`"node16"` to fix this properly
// is a bigger, riskier change than this file's scope.
declare module 'kokoro-js' {
  export interface RawAudio {
    audio: Float32Array;
    sampling_rate: number;
    save(path: string): Promise<void>;
  }

  export interface GenerateOptions {
    voice?: string;
    speed?: number;
  }

  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: {
        dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
        device?: 'wasm' | 'webgpu' | 'cpu' | null;
      },
    ): Promise<KokoroTTS>;
    generate(text: string, options?: GenerateOptions): Promise<RawAudio>;
  }
}
