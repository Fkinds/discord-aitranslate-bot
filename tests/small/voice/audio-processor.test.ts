import { describe, it, expect, beforeEach } from '@jest/globals';
import { AudioProcessor } from '../../../src/voice/audio-processor';
import type { Logger } from '../../../src/types';
import { createMockLogger } from '../../helpers/mocks';
import { createMockOpusBuffer, createMockPCMBuffer } from '../../helpers/fixtures';

describe('AudioProcessor', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('constructor', () => {
    it('should create an AudioProcessor instance', () => {
      const processor = new AudioProcessor(mockLogger);
      expect(processor).toBeInstanceOf(AudioProcessor);
    });

    it('should log initialization', () => {
      new AudioProcessor(mockLogger);
      expect(mockLogger.info).toHaveBeenCalledWith('AudioProcessor initialized');
    });
  });

  describe('convertOpusToPCM', () => {
    it('should convert Opus to PCM format', async () => {
      const processor = new AudioProcessor(mockLogger);
      const opusData = createMockOpusBuffer(960);

      const result = await processor.convertOpusToPCM(opusData);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle empty Opus data', async () => {
      const processor = new AudioProcessor(mockLogger);
      const emptyOpus = Buffer.alloc(0);

      const result = await processor.convertOpusToPCM(emptyOpus);

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('resample', () => {
    it('should resample audio to target sample rate', async () => {
      const processor = new AudioProcessor(mockLogger);
      const pcmData = createMockPCMBuffer(9600, 2); // 48kHz stereo, 100ms

      const result = await processor.resample(pcmData, 48000, 16000);

      expect(result).toBeInstanceOf(Buffer);
      // Downsampling 48kHz to 16kHz and stereo to mono should reduce size significantly
      expect(result.length).toBeLessThan(pcmData.length);
    });

    it('should convert stereo to mono during resampling', async () => {
      const processor = new AudioProcessor(mockLogger);
      const stereoData = createMockPCMBuffer(4800, 2); // 48kHz stereo, 50ms

      const result = await processor.resample(stereoData, 48000, 16000);

      // Mono output should be roughly 1/6 the size (1/3 sample rate * 1/2 channels)
      const expectedSize = Math.floor((stereoData.length / 2) / 3);
      expect(result.length).toBeCloseTo(expectedSize, -1);
    });

    it('should handle zero-length PCM data', async () => {
      const processor = new AudioProcessor(mockLogger);
      const emptyPCM = Buffer.alloc(0);

      const result = await processor.resample(emptyPCM, 48000, 16000);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(0);
    });
  });
});
