// Ambient fallback types for the optional `nodejs-whisper` dependency.
//
// nodejs-whisper is listed in optionalDependencies (its postinstall vendors
// whisper.cpp source but doesn't compile it, so it never breaks `npm
// install`). This declaration lets tsc typecheck transcription.ts's dynamic
// `import('nodejs-whisper')` on ANY machine, whether or not the optional
// dependency actually resolved — real installed types win automatically
// when present; this is the fallback when they aren't. The runtime import
// itself is wrapped in try/catch in transcription.ts.
declare module 'nodejs-whisper' {
  export interface WhisperOptions {
    outputInCsv?: boolean;
    outputInJson?: boolean;
    outputInJsonFull?: boolean;
    outputInLrc?: boolean;
    outputInSrt?: boolean;
    outputInText?: boolean;
    outputInVtt?: boolean;
    outputInWords?: boolean;
    translateToEnglish?: boolean;
    language?: string;
    timestamps_length?: number;
    wordTimestamps?: boolean;
    splitOnWord?: boolean;
    noGpu?: boolean;
  }

  export interface NodeWhisperOptions {
    modelName: string;
    modelRootPath?: string;
    autoDownloadModelName?: string;
    whisperOptions?: WhisperOptions;
    withCuda?: boolean;
    removeWavFileAfterTranscription?: boolean;
    logger?: {
      debug: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      log: (...args: unknown[]) => void;
    };
  }

  export function nodewhisper(
    filePath: string,
    options: NodeWhisperOptions,
  ): Promise<string>;
}
