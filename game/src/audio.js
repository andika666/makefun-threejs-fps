// All sound is synthesized with WebAudio: no audio files, no network. One shared
// noise buffer, a few oscillators, and envelopes. Every call is cheap and safe to
// call before the context exists (it unlocks on the first user gesture).

let context = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (context) return context;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  context = new AC();
  master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);
  const length = context.sampleRate * 1;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return context;
}

function noise({ duration, type = 'bandpass', frequency = 1200, q = 0.8, gain = 0.5, at = 0, sweepTo = 0 }) {
  if (!ensure()) return;
  const t = context.currentTime + at;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, t);
  if (sweepTo > 0) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
  filter.Q.value = q;
  const amp = context.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  source.connect(filter).connect(amp).connect(master);
  source.start(t);
  source.stop(t + duration + 0.05);
}

function tone({ frequency = 440, to = 0, duration = 0.12, type = 'sine', gain = 0.25, at = 0 }) {
  if (!ensure()) return;
  const t = context.currentTime + at;
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  if (to > 0) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  const amp = context.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// Shot signatures: a crack (high noise) plus a body thump (low noise). Distant
// shots are the same shape, quieter and duller, so the player hears fights.
const SHOT_PROFILE = {
  pistol: { crack: 2400, body: 320, gain: 0.5, duration: 0.09 },
  smg: { crack: 2800, body: 380, gain: 0.42, duration: 0.07 },
  rifle: { crack: 1800, body: 240, gain: 0.6, duration: 0.12 },
  sniper: { crack: 1400, body: 160, gain: 0.8, duration: 0.22 },
};

export function createAudio() {
  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    shot(kind, distance = 0) {
      const profile = SHOT_PROFILE[kind] || SHOT_PROFILE.rifle;
      const dull = Math.min(1, distance / 45);
      const gain = profile.gain * (1 - dull * 0.75);
      if (gain < 0.03) return;
      noise({ duration: profile.duration, frequency: profile.crack * (1 - dull * 0.6), gain });
      noise({ duration: profile.duration * 1.6, type: 'lowpass', frequency: profile.body, gain: gain * 0.9 });
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.1 });
      tone({ frequency: 600, duration: 0.05, type: 'square', gain: 0.12, at: 0.35 });
      tone({ frequency: 1100, duration: 0.04, type: 'square', gain: 0.12, at: 0.7 });
    },
    hit(kill) {
      tone({ frequency: 1900, duration: 0.05, type: 'square', gain: 0.16 });
      if (kill) tone({ frequency: 2400, duration: 0.09, type: 'square', gain: 0.16, at: 0.06 });
    },
    hurt() {
      noise({ duration: 0.12, type: 'lowpass', frequency: 500, gain: 0.35 });
      tone({ frequency: 160, to: 90, duration: 0.14, type: 'sine', gain: 0.3 });
    },
    step() {
      noise({ duration: 0.05, type: 'lowpass', frequency: 700, gain: 0.05 });
    },
    bounce() {
      tone({ frequency: 300, to: 180, duration: 0.07, type: 'triangle', gain: 0.15 });
    },
    explosion() {
      noise({ duration: 0.9, type: 'lowpass', frequency: 900, sweepTo: 90, gain: 0.9 });
      tone({ frequency: 70, to: 32, duration: 0.8, type: 'sine', gain: 0.7 });
    },
    beep(urgent = false) {
      tone({ frequency: urgent ? 1200 : 880, duration: 0.07, type: 'square', gain: 0.14 });
    },
    plantTick() {
      tone({ frequency: 660, duration: 0.05, type: 'square', gain: 0.1 });
    },
    buy() {
      tone({ frequency: 1320, duration: 0.06, type: 'sine', gain: 0.18 });
      tone({ frequency: 1760, duration: 0.09, type: 'sine', gain: 0.18, at: 0.07 });
    },
    deny() {
      tone({ frequency: 220, duration: 0.12, type: 'square', gain: 0.15 });
    },
    roundWin() {
      [523, 659, 784].forEach((frequency, i) => tone({ frequency, duration: 0.16, gain: 0.2, at: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((frequency, i) => tone({ frequency, duration: 0.18, gain: 0.2, at: i * 0.12 }));
    },
    // A soft tick while the bomb counts down; the interval is the caller's job.
    bombTick() {
      tone({ frequency: 1500, duration: 0.04, type: 'square', gain: 0.1 });
    },
  };
}
