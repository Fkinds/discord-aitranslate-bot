import { describe, it, expect } from '@jest/globals';
import { LOCAL_MODEL_FILES } from '../../../../src/infrastructure/local/model-files';

describe('LOCAL_MODEL_FILES', () => {
  it('lists the voice detector, the speech recognizer and the translation model', () => {
    expect(LOCAL_MODEL_FILES.map((file) => file.path)).toEqual([
      'silero-vad/silero_vad.onnx',
      'whisper-large-v3-turbo/turbo-encoder.int8.onnx',
      'whisper-large-v3-turbo/turbo-decoder.int8.onnx',
      'whisper-large-v3-turbo/turbo-tokens.txt',
      'hy-mt2-1.8b/Hy-MT2-1.8B-Q4_K_M.gguf',
    ]);
  });

  it.each(LOCAL_MODEL_FILES.map((file) => [file.path, file] as const))('downloads %s from a fixed revision', (_path, file) => {
    const url = new URL(file.url);

    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/\/[0-9a-f]{40}\//);
  });

  it.each(LOCAL_MODEL_FILES.map((file) => [file.path, file] as const))('knows the size and SHA-256 of %s', (_path, file) => {
    expect(Number.isSafeInteger(file.bytes) && file.bytes > 0).toBe(true);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps every file under the models directory, each in its own place', () => {
    const paths = LOCAL_MODEL_FILES.map((file) => file.path);

    for (const path of paths) expect(path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
