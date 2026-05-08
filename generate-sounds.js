// Generates ASMR squishy soft-toy sound effects as WAV files into /sounds/
// Run once: node generate-sounds.js

const fs   = require('fs')
const path = require('path')

const SR = 44100
const OUT = path.join(__dirname, 'sounds')
fs.mkdirSync(OUT, { recursive: true })

function wav(filename, dur, fn) {
  const n   = Math.ceil(SR * dur)
  const d   = new Float32Array(n)
  fn(d, SR)
  // Gentle limiter to prevent clipping
  for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i])
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0);  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8);  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1,  22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2,  32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, d[i] * 32767 | 0)), 44 + i * 2)
  fs.writeFileSync(path.join(OUT, filename), buf)
  console.log(`  ✓  sounds/${filename}`)
}

// Simple 1-pole low-pass filter state
function makeLPF(cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff)
  const dt = 1 / SR
  const a  = dt / (rc + dt)
  let y = 0
  return (x) => { y += a * (x - y); return y }
}

// ── pop: squishy foam button press (green) ─────────────────────────────────────
// Deep bloop: frequency drops from 320→55 Hz (compressed foam releasing)
// + warm noise burst on attack for tactile texture
wav('pop.wav', 0.28, (d, sr) => {
  const lpf = makeLPF(280)
  let ph = 0, ph2 = 0
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, dur = 0.24
    // Squishy compression sweep
    const freq = 320 * Math.pow(55 / 320, t / dur)
    // Subtle vibrato for organic feel
    const vib  = 1 + 0.018 * Math.sin(2 * Math.PI * 14 * t) * Math.exp(-t * 6)
    ph  += 2 * Math.PI * freq * vib / sr
    ph2 += 2 * Math.PI * freq * 2  * vib / sr
    // Soft attack envelope (no click) + exponential decay
    const env = (1 - Math.exp(-t / 0.009)) * Math.exp(-t * 9)
    // Warm noise on attack (air escaping from foam)
    const noise = lpf(Math.random() * 2 - 1) * 0.22 * Math.exp(-t * 45)
    d[i] = (Math.sin(ph) * 0.70 + Math.sin(ph2) * 0.12 + noise) * env * 0.95
  }
})

// ── ping: tiny rubber squeak (button appears) ─────────────────────────────────
// Like a mini rubber duck — short, airy, soft
wav('ping.wav', 0.18, (d, sr) => {
  let ph = 0
  for (let i = 0; i < d.length; i++) {
    const t  = i / sr, dur = 0.15
    // Pitch rises then falls (squeeze-and-release)
    const pct  = t / dur
    const freq = 680 * Math.pow(2, Math.sin(pct * Math.PI) * 0.35)
    ph += 2 * Math.PI * freq / sr
    const env = (1 - Math.exp(-t / 0.005)) * Math.exp(-t * 18)
    d[i] = Math.sin(ph) * 0.45 * env
  }
})

// ── bomb: glass crack/shatter (game over — hit purple) ─────────────────────
// Sharp, high-frequency transients and stiff metallic resonance for breaking glass
wav('bomb.wav', 1.5, (d, sr) => {
  // Simple 1-pole high-pass filter
  function makeHPF(cutoff, sr) {
    const rc = 1 / (2 * Math.PI * cutoff)
    const dt = 1 / sr
    const a  = rc / (rc + dt)
    let prevX = 0, prevY = 0
    return (x) => {
      const y = a * (prevY + x - prevX)
      prevX = x
      prevY = y
      return y
    }
  }

  const hpf = makeHPF(1500, sr) 

  // Random crack events
  const cracks = [0] // Main impact
  for(let j=0; j<12; j++) cracks.push(Math.random() * 0.35 + 0.02)
  
  // Frequencies for glass resonance
  const freqs = [2100, 3450, 4820, 6100, 7500]

  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    let v = 0
    
    // Impact noise (shatter)
    let noiseSum = 0
    cracks.forEach((ct, idx) => {
      if (t >= ct) {
        const dt = t - ct
        // Sharp attack, extremely fast decay for each shard click
        const amp = idx === 0 ? 1.0 : (0.2 + Math.random() * 0.3)
        noiseSum += Math.exp(-dt * 300) * amp
      }
    })
    
    const noise = hpf(Math.random() * 2 - 1)
    v += noise * noiseSum * 1.5

    // High frequency metallic/glass resonance
    let res = 0
    freqs.forEach((f, idx) => {
      const env = Math.exp(-t * (15 + idx * 5))
      // Slight pitch bend down to simulate stress release
      const pitchBend = f * Math.pow(0.95, t * 10)
      res += Math.sin(2 * Math.PI * pitchBend * t) * env * 0.15
    })
    v += res
    
    // Final master volume tweak
    d[i] = Math.max(-1, Math.min(1, v * 0.9))
  }
})

// ── squish tick: countdown soft thwack (replaces beep 660) ───────────────────
// A muted, rubbery tap — like flicking a stuffed animal's nose
wav('beep660.wav', 0.18, (d, sr) => {
  const lpf = makeLPF(400)
  let ph = 0
  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    const freq = 520 * Math.pow(180 / 520, t / 0.14)
    ph += 2 * Math.PI * freq / sr
    const noise = lpf(Math.random() * 2 - 1) * Math.exp(-t * 50) * 0.25
    const env = (1 - Math.exp(-t / 0.005)) * Math.exp(-t * 22)
    d[i] = (Math.sin(ph) * 0.55 + noise) * env
  }
})

// ── urgency squeak: last 5 seconds (replaces beep 880) ───────────────────────
// Higher, quicker squeeze — like a toy giving a small warning peep
wav('beep880.wav', 0.12, (d, sr) => {
  let ph = 0
  for (let i = 0; i < d.length; i++) {
    const t   = i / sr, dur = 0.10
    const pct = t / dur
    const freq = 760 * Math.pow(2, Math.sin(pct * Math.PI) * 0.30)
    ph += 2 * Math.PI * freq / sr
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t * 28)
    d[i] = Math.sin(ph) * 0.40 * env
  }
})

// ── go: satisfying cascade of bloops (game start) ─────────────────────────────
// 4 ascending squishy bloops in quick succession — like pressing bubble wrap
wav('go.wav', 0.75, (d, sr) => {
  const notes  = [180, 240, 310, 400]  // rising bloop pitches
  const delays = [0,   0.10, 0.20, 0.30]
  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    let v = 0
    notes.forEach((baseFreq, ni) => {
      const nt = t - delays[ni]
      if (nt < 0 || nt > 0.28) return
      const freq = baseFreq * Math.pow(0.25, nt / 0.24)
      // Each note has its own phase accumulator — approximate with closed form
      const ph = baseFreq * (24 / Math.log(baseFreq / (baseFreq * 0.25))) * (1 - Math.pow(0.25, nt / 0.24))
      const env = (1 - Math.exp(-nt / 0.008)) * Math.exp(-nt * 9)
      v += Math.sin(2 * Math.PI * ph) * 0.55 * env
    })
    d[i] = Math.max(-1, Math.min(1, v * 0.75))
  }
})

// ── success: longer bubble-wrap cascade (time's up / good ending) ──────────────
// A triumphant major arpeggio cascade of squishes
wav('success.wav', 2.5, (d, sr) => {
  const notes  = [164, 207, 246, 329, 415, 493, 659, 830, 987, 1318]
  const delays = [0, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 1.05, 1.20, 1.35]
  // Per-note phase tracking
  const phases = new Float64Array(notes.length)
  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    let v = 0
    notes.forEach((baseFreq, ni) => {
      const nt = t - delays[ni]
      if (nt < 0 || nt > 1.2) return
      const freq = baseFreq * Math.pow(0.5, nt / 1.0)
      phases[ni] += 2 * Math.PI * freq / sr
      const vib = 1 + 0.015 * Math.sin(2 * Math.PI * 12 * nt) * Math.exp(-nt * 3)
      const env = (1 - Math.exp(-nt / 0.008)) * Math.exp(-nt * 3)
      v += (Math.sin(phases[ni] * vib) * 0.65 + Math.sin(phases[ni] * 2 * vib) * 0.10) * env * 0.50
    })
    d[i] = Math.max(-1, Math.min(1, v))
  }
})

// ── bgm: 64-second upbeat squishy background track (evolving) ───────────────
wav('bgm.wav', 64.0, (d, sr) => {
  const bpm = 120
  const beat = 60 / bpm // 0.5s per beat
  
  // C major pentatonic for melody
  const pentatonic = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3]
  
  // Roots for a long 32-bar progression (1 bar = 4 beats = 2 seconds)
  const roots = [
    130.8, 196.0, 220.0, 174.6, // C G Am F
    130.8, 196.0, 146.8, 174.6, // C G Dm F
    220.0, 174.6, 130.8, 196.0, // Am F C G
    146.8, 220.0, 174.6, 196.0, // Dm Am F G
    174.6, 130.8, 196.0, 220.0, // F C G Am
    174.6, 196.0, 130.8, 130.8, // F G C C
    220.0, 164.8, 174.6, 130.8, // Am Em F C
    146.8, 196.0, 130.8, 130.8, // Dm G C C
  ]
  
  // Simple hash function for pseudo-random melody
  function hash(n) {
    let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    let v = 0
    
    // Determine current bar and beat
    const totalBeats = Math.floor(t / beat)
    const bar = Math.floor(totalBeats / 4)
    const rootFreq = roots[bar % roots.length]
    
    // Bass (every beat)
    const bassT = t % beat
    const bassEnv = (1 - Math.exp(-bassT / 0.01)) * Math.exp(-bassT * 3)
    const isOffBeat = totalBeats % 2 !== 0
    const bassFreq = isOffBeat ? rootFreq * 2 : rootFreq
    v += Math.sin(2 * Math.PI * bassFreq * t) * 0.3 * bassEnv
    
    // Arpeggio/Melody (every half beat)
    const halfBeatT = t % (beat / 2)
    const halfBeatIdx = Math.floor(t / (beat / 2))
    
    // Generate an evolving pattern based on the bar and halfBeatIdx
    const patternSeed = (Math.floor(bar / 2)) * 10 + (halfBeatIdx % 8)
    const randomVal = hash(patternSeed)
    
    const noteIdx = Math.floor(randomVal * pentatonic.length)
    const melNote = pentatonic[noteIdx]
    
    const isRest = hash(patternSeed + 100) > 0.85
    if (!isRest) {
      const melEnv = (1 - Math.exp(-halfBeatT / 0.005)) * Math.exp(-halfBeatT * 6)
      v += Math.sin(2 * Math.PI * melNote * t) * 0.15 * melEnv
    }
    
    // Subtle squish hi-hat on 1/4 beats
    const qBeatT = t % (beat / 4)
    const qBeatIdx = Math.floor(t / (beat / 4))
    if (qBeatIdx % 2 !== 0) {
       v += (Math.random() * 2 - 1) * 0.03 * Math.exp(-qBeatT * 50)
    }

    // Soft pad/chords that fade in and out based on the root
    const padEnv = 0.5 + 0.5 * Math.sin(t * Math.PI / 2)
    v += Math.sin(2 * Math.PI * rootFreq * t) * 0.06 * padEnv
    v += Math.sin(2 * Math.PI * rootFreq * 1.5 * t) * 0.04 * padEnv

    d[i] = Math.max(-1, Math.min(1, v))
  }
})

console.log('\nAll squishy sounds generated.')
