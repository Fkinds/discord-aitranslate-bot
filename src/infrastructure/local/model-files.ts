/**
 * A file that a local model needs, as its source published it at a fixed
 * version, so that every download gets the same bytes.
 */
export interface ModelFile {
  /** Where the file goes under the models directory, with "/" between the parts. */
  readonly path: string;
  /** Where to download it: a URL that names a fixed revision, never a branch. */
  readonly url: string;
  /** Its size in bytes. */
  readonly bytes: number;
  /** The SHA-256 of its contents (FIPS 180-4), in lowercase hex. */
  readonly sha256: string;
}

function huggingFace(repository: string, revision: string, name: string): string {
  return `https://huggingface.co/${repository}/resolve/${revision}/${name}`;
}

/**
 * Silero VAD v6.2.3 (MIT), which tells speech from silence and noise.
 * https://github.com/snakers4/silero-vad
 */
export const VAD_MODEL = {
  model: {
    path: 'silero-vad/silero_vad.onnx',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/5cd7945676eb32225748052e2e6a0580e4686a08/src/silero_vad/data/silero_vad.onnx',
    bytes: 2_327_524,
    sha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
  },
} as const satisfies Record<string, ModelFile>;

const WHISPER_REPOSITORY = 'csukuangfj/sherpa-onnx-whisper-turbo';
const WHISPER_REVISION = '2ca6ff69fc878651b770880507669577ac41c2ff';

/**
 * Whisper large-v3-turbo (MIT), which transcribes speech and tells its
 * language, quantized to int8 for sherpa-onnx by the maintainer of sherpa-onnx.
 * https://huggingface.co/csukuangfj/sherpa-onnx-whisper-turbo
 */
export const WHISPER_MODEL = {
  encoder: {
    path: 'whisper-large-v3-turbo/turbo-encoder.int8.onnx',
    url: huggingFace(WHISPER_REPOSITORY, WHISPER_REVISION, 'turbo-encoder.int8.onnx'),
    bytes: 674_716_297,
    sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b',
  },
  decoder: {
    path: 'whisper-large-v3-turbo/turbo-decoder.int8.onnx',
    url: huggingFace(WHISPER_REPOSITORY, WHISPER_REVISION, 'turbo-decoder.int8.onnx'),
    bytes: 361_080_764,
    sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547',
  },
  tokens: {
    path: 'whisper-large-v3-turbo/turbo-tokens.txt',
    url: huggingFace(WHISPER_REPOSITORY, WHISPER_REVISION, 'turbo-tokens.txt'),
    bytes: 816_730,
    sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126',
  },
} as const satisfies Record<string, ModelFile>;

/** Every file for hearing speech on this machine: what `pnpm models:download` downloads. */
export const LOCAL_MODEL_FILES: readonly ModelFile[] = Object.freeze([...Object.values(VAD_MODEL), ...Object.values(WHISPER_MODEL)]);
