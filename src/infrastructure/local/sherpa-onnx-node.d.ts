// Types for the parts of sherpa-onnx-node (https://github.com/k2-fsa/sherpa-onnx,
// Apache-2.0) that the local speech recognizer uses. The package ships no type
// declarations; these follow the JSDoc types in its types.js, vad.js and
// non-streaming-asr.js at 2.0.1.
declare module 'sherpa-onnx-node' {
  export interface SileroVadModelConfig {
    readonly model: string;
    /** How likely speech must be, from 0 to 1, for a window to count as speech. */
    readonly threshold?: number;
    /** Seconds of silence that end a stretch of speech. */
    readonly minSilenceDuration?: number;
    /** Seconds a stretch of speech must last to count. */
    readonly minSpeechDuration?: number;
    /** Seconds after which a stretch of speech is cut, even without silence. */
    readonly maxSpeechDuration?: number;
    /** Samples per window: 512 at 16 kHz. */
    readonly windowSize?: number;
  }

  export interface VadConfig {
    readonly sileroVad: SileroVadModelConfig;
    readonly sampleRate: number;
    readonly numThreads?: number;
    readonly provider?: string;
    readonly debug?: boolean;
  }

  export interface SpeechSegment {
    /** The index of its first sample. */
    readonly start: number;
    readonly samples: Float32Array;
  }

  /** Silero voice activity detection: finds the stretches of speech in samples fed to it. */
  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    /** Whether no stretch of speech is waiting to be taken. */
    isEmpty(): boolean;
    /** The earliest stretch of speech; with `false`, its samples are a copy that stays valid after `pop()`. */
    front(enableExternalBuffer?: boolean): SpeechSegment;
    pop(): void;
    /** End the stretch of speech in progress, as if silence followed. */
    flush(): void;
    reset(): void;
  }

  export interface OfflineWhisperModelConfig {
    readonly encoder: string;
    readonly decoder: string;
    /** A language code such as "ja", or "" to have Whisper tell the language. */
    readonly language?: string;
    readonly task?: 'transcribe' | 'translate';
  }

  export interface OfflineRecognizerConfig {
    readonly modelConfig: {
      readonly whisper: OfflineWhisperModelConfig;
      readonly tokens: string;
      readonly numThreads?: number;
      readonly provider?: string;
      readonly debug?: boolean;
    };
  }

  export interface OfflineRecognizerResult {
    readonly text: string;
    /** The language Whisper heard, such as "ja". */
    readonly lang: string;
  }

  export class OfflineStream {
    acceptWaveform(waveform: { readonly samples: Float32Array; readonly sampleRate: number }): void;
  }

  export class OfflineRecognizer {
    /** Load the models without blocking the event loop. */
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    /** Recognize the speech in the stream without blocking the event loop. */
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>;
  }
}
