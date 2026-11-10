import prism from 'prism-media';
import type { Logger } from '../types';
import { ErrorType, TranslatorError } from '../types';

/**
 * Audio processor for handling Discord voice streams
 */
export class AudioProcessor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;

    this.logger.info('AudioProcessor initialized');
  }

  /**
   * Convert Opus audio to PCM format
   */
  async convertOpusToPCM(opusData: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Discord always sends stereo audio at 48kHz, regardless of our output preferences
        const decoder = new prism.opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960,
        });

        const chunks: Buffer[] = [];

        decoder.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        decoder.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        decoder.on('error', (error: Error) => {
          reject(
            new TranslatorError(
              ErrorType.AUDIO_PROCESSING_ERROR,
              'Failed to decode Opus audio',
              error
            )
          );
        });

        decoder.write(opusData);
        decoder.end();
      } catch (error) {
        reject(
          new TranslatorError(
            ErrorType.AUDIO_PROCESSING_ERROR,
            'Failed to convert Opus to PCM',
            error as Error
          )
        );
      }
    });
  }

  /**
   * Resample audio to target sample rate and convert stereo to mono
   * Uses simple linear interpolation for downsampling
   */
  async resample(
    pcmData: Buffer,
    sourceSampleRate: number,
    targetSampleRate: number
  ): Promise<Buffer> {
    console.log(`   🔄 Resampling ${pcmData.length} bytes from ${sourceSampleRate}Hz stereo to ${targetSampleRate}Hz mono...`);

    // Convert buffer to Int16Array (16-bit PCM samples)
    const sourceSamples = new Int16Array(
      pcmData.buffer,
      pcmData.byteOffset,
      pcmData.length / 2
    );

    // Source is stereo (2 channels), target is mono (1 channel)
    const sourceFrames = sourceSamples.length / 2; // Each frame has 2 samples (L+R)
    const ratio = sourceSampleRate / targetSampleRate;
    const targetFrames = Math.floor(sourceFrames / ratio);

    console.log(`   📊 Source: ${sourceFrames} stereo frames, Target: ${targetFrames} mono frames`);

    // Create output buffer for mono samples
    const targetSamples = new Int16Array(targetFrames);

    // Resample with linear interpolation and convert stereo to mono
    for (let i = 0; i < targetFrames; i++) {
      const sourceIndex = i * ratio;
      const sourceFrame = Math.floor(sourceIndex);
      const fraction = sourceIndex - sourceFrame;

      // Get left and right channels for current frame
      const leftIndex = sourceFrame * 2;
      const rightIndex = leftIndex + 1;

      if (rightIndex < sourceSamples.length) {
        // Average left and right channels to convert to mono
        const monoSample = Math.floor(
          (sourceSamples[leftIndex] + sourceSamples[rightIndex]) / 2
        );

        // Linear interpolation with next frame if available
        if (leftIndex + 2 < sourceSamples.length) {
          const nextMonoSample = Math.floor(
            (sourceSamples[leftIndex + 2] + sourceSamples[leftIndex + 3]) / 2
          );
          targetSamples[i] = Math.floor(
            monoSample * (1 - fraction) + nextMonoSample * fraction
          );
        } else {
          targetSamples[i] = monoSample;
        }
      }
    }

    const outputBuffer = Buffer.from(targetSamples.buffer);
    console.log(`   ✅ Resampled to ${outputBuffer.length} bytes (${targetFrames} mono samples)`);

    return outputBuffer;
  }
}
