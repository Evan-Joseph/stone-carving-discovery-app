// Web Audio API Synthesizer for Stone Carving Archaeology Experience
// Zero external audio assets, zero latency, offline native sound effects

let audioCtx: AudioContext | null = null;
const STORAGE_KEY_MUTED = "stone_app_sound_muted";

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

export function isAudioMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY_MUTED) === "true";
}

export function setAudioMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_MUTED, muted ? "true" : "false");
}

export function toggleAudioMuted(): boolean {
  const next = !isAudioMuted();
  setAudioMuted(next);
  return next;
}

/**
 * Play a synthetic chisel / stone-chipping sound
 * Combines high-frequency metallic impact noise and low-frequency stone resonant body decay
 */
export function playChiselSound(pitchVariance = 1.0): void {
  if (isAudioMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1. High frequency chisel transient (noise burst)
  const bufferSize = Math.floor(ctx.sampleRate * 0.045); // 45ms noise burst
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
  }

  const whiteNoise = ctx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  // Randomize pitch slightly around 2800Hz
  filter.frequency.setValueAtTime((2400 + Math.random() * 1200) * pitchVariance, now);
  filter.Q.setValueAtTime(6.0, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.35, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

  whiteNoise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  whiteNoise.start(now);
  whiteNoise.stop(now + 0.05);

  // 2. Stone body resonant thump (low-mid transient)
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();

  osc.type = "triangle";
  const startFreq = (380 + Math.random() * 120) * pitchVariance;
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.06);

  oscGain.gain.setValueAtTime(0.25, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

/**
 * Play a ceremonial ancient stone chime / gong resonance upon 100% artifact excavation
 * Uses classical pentatonic intervals (Gong/Shang/Zhi) with long harmonic decay
 */
export function playArtifactFoundFanfare(): void {
  if (isAudioMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // Pentatonic notes: C4 (261.63Hz), G4 (392.00Hz), C5 (523.25Hz), E5 (659.25Hz)
  const frequencies = [261.63, 392.0, 523.25, 659.25];

  frequencies.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = index % 2 === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(freq, now + index * 0.06);

    const startTime = now + index * 0.06;
    const duration = 1.4 - index * 0.15;

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  });
}
