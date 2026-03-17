const ACCUMULATION_SIZE = 4096; // ~85ms at 16kHz (was 16384 = ~341ms at 48kHz)

function downsampleFloat32(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = samples[index] ?? 0;
    output[i] = a + frac * ((samples[index + 1] ?? a) - a);
  }
  return output;
}

function float32ToBase64Pcm(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) this._buffer.push(input[i]);

    while (this._buffer.length >= ACCUMULATION_SIZE) {
      const chunk = new Float32Array(this._buffer.splice(0, ACCUMULATION_SIZE));
      const rms = getRms(chunk);
      // sampleRate is a global in AudioWorkletProcessor context
      const downsampled = downsampleFloat32(chunk, sampleRate, 16000);
      this.port.postMessage({
        data: float32ToBase64Pcm(downsampled),
        rms,
      });
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
