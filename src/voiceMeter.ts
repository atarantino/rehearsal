export const voiceBarCount = 19;

export type VoiceLevels = {
  user: number;
  assistant: number;
  bands: number[];
};

export function createVoiceMeter(context: AudioContext, stream: MediaStream) {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // Apply our own attack/release so pauses settle without a long FFT tail.
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const bands = Array<number>(voiceBarCount).fill(0);
  const binHz = context.sampleRate / analyser.fftSize;
  const edges = Array.from({ length: voiceBarCount + 1 }, (_, i) =>
    Math.min(
      spectrum.length,
      Math.max(
        1,
        Math.round((90 * (6500 / 90) ** (i / voiceBarCount)) / binHz),
      ),
    ),
  );
  let level = 0;
  const smooth = (previous: number, next: number, elapsedMs: number) => {
    const factor = 1 - Math.exp(-elapsedMs / (next > previous ? 45 : 150));
    const result = previous + (next - previous) * factor;
    return result < 0.002 ? 0 : result;
  };

  return {
    read(active: boolean, elapsedMs: number) {
      if (!active) {
        level = 0;
        bands.fill(0);
        return { level, bands };
      }
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
          samples.length,
      );
      const audible = rms >= 0.008;
      level = smooth(level, audible ? Math.min(1, rms * 7) : 0, elapsedMs);
      analyser.getFloatFrequencyData(spectrum);
      for (let i = 0; i < bands.length; i++) {
        const end = Math.min(
          spectrum.length,
          Math.max(edges[i] + 1, edges[i + 1]),
        );
        let power = 0;
        for (let bin = edges[i]; bin < end; bin++)
          power += 10 ** (spectrum[bin] / 10);
        const energy = Math.min(1, Math.sqrt(power) * 12);
        bands[i] = smooth(bands[i], audible ? energy : 0, elapsedMs);
      }
      return { level, bands };
    },
    disconnect() {
      source.disconnect();
      analyser.disconnect();
    },
  };
}
