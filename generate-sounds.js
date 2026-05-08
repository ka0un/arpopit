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

// ── bomb: deep wet squash (game over — hit purple) ────────────────────────────
// Heavy "SMOOSH": low thud layer + air-rush noise + rubbery body resonance
wav('bomb.wav', 0.75, (d, sr) => {
  const lpfNoise = makeLPF(180)
  let ph1 = 0, ph2 = 0, ph3 = 0
  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    // Very deep body: 140→22 Hz
    const f1 = 140 * Math.pow(22 / 140, t / 0.60)
    ph1 += 2 * Math.PI * f1 / sr
    // Mid squish layer: 280→55 Hz
    const f2 = 280 * Math.pow(55 / 280, t / 0.35)
    ph2 += 2 * Math.PI * f2 / sr
    // Tiny high squeak at impact (rubbery)
    const f3 = 820 * Math.pow(200 / 820, t / 0.12)
    ph3 += 2 * Math.PI * f3 / sr
    const squeakEnv = Math.exp(-t * 30)
    // Muffled air rush on hit
    const rush = lpfNoise(Math.random() * 2 - 1) * Math.exp(-t * 12) * 0.35
    const e1 = (1 - Math.exp(-t / 0.012)) * Math.exp(-t * 5)
    const e2 = (1 - Math.exp(-t / 0.008)) * Math.exp(-t * 10)
    d[i] = Math.sin(ph1) * 0.65 * e1
         + Math.sin(ph2) * 0.30 * e2
         + Math.sin(ph3) * 0.18 * squeakEnv
         + rush
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

// ── success: bubble-wrap cascade (time's up / good ending) ────────────────────
// 5 satisfying ascending squishes — very ASMR, like popping a row of bubbles
wav('success.wav', 1.0, (d, sr) => {
  const notes  = [160, 210, 270, 340, 430]
  const delays = [0, 0.12, 0.24, 0.36, 0.48]
  // Per-note phase tracking
  const phases = new Float64Array(notes.length)
  for (let i = 0; i < d.length; i++) {
    const t = i / sr
    let v = 0
    notes.forEach((baseFreq, ni) => {
      const nt = t - delays[ni]
      if (nt < 0 || nt > 0.35) return
      const freq = baseFreq * Math.pow(0.22, nt / 0.30)
      phases[ni] += 2 * Math.PI * freq / sr
      const vib = 1 + 0.015 * Math.sin(2 * Math.PI * 12 * nt) * Math.exp(-nt * 5)
      const env = (1 - Math.exp(-nt / 0.008)) * Math.exp(-nt * 7)
      // Mix fundamental + soft 2nd harmonic
      v += (Math.sin(phases[ni] * vib) * 0.65 + Math.sin(phases[ni] * 2 * vib) * 0.10) * env * 0.60
    })
    d[i] = Math.max(-1, Math.min(1, v))
  }
})

console.log('\nAll squishy sounds generated.')
