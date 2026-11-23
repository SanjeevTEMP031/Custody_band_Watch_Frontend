/**
 * Real-Time Alert Sound Notification System
 * Uses the Web Audio API to synthesize distinct, priority-based audible alarm sounds
 * directly in the browser without relying on external audio files that could fail to load.
 */

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

/**
 * Plays an audible notification sound based on alert severity.
 * @param severity 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO'
 */
export function playAlertSound(severity: string = 'HIGH') {
  try {
    const enabled = localStorage.getItem('purview-alarm-sound') !== 'false'
    if (!enabled) return

    const ctx = getAudioContext()
    if (!ctx) return

    const sev = severity.toUpperCase()
    const now = ctx.currentTime

    if (sev === 'CRITICAL') {
      // Urgent, rapid two-tone pulsing alarm (Siren / Klaxon)
      playCriticalAlarm(ctx, now)
    } else if (sev === 'HIGH') {
      // Distinct warning sound: Rapid dual-beep pulse
      playHighWarning(ctx, now)
    } else if (sev === 'MEDIUM') {
      // Distinct advisory chime / double-beep
      playMediumChime(ctx, now)
    } else {
      // Subtle single soft notification chime
      playInfoChime(ctx, now)
    }
  } catch (err) {
    console.debug('[AlertAudio] Unable to play sound:', err)
  }
}

/**
 * CRITICAL: Distinct urgent alarm (Rapid alternating 880Hz / 660Hz pulses)
 */
function playCriticalAlarm(ctx: AudioContext, startTime: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sawtooth'

  // Alternating frequency sequence: 880Hz -> 660Hz -> 880Hz -> 660Hz
  osc.frequency.setValueAtTime(880, startTime)
  osc.frequency.setValueAtTime(660, startTime + 0.12)
  osc.frequency.setValueAtTime(880, startTime + 0.24)
  osc.frequency.setValueAtTime(660, startTime + 0.36)
  osc.frequency.setValueAtTime(880, startTime + 0.48)
  osc.frequency.setValueAtTime(660, startTime + 0.60)

  // Pulsing volume envelope
  gain.gain.setValueAtTime(0.001, startTime)
  gain.gain.linearRampToValueAtTime(0.35, startTime + 0.03)
  gain.gain.setValueAtTime(0.35, startTime + 0.70)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.85)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(startTime)
  osc.stop(startTime + 0.85)
}

/**
 * HIGH: Distinct warning sound (750Hz dual-beep pulse)
 */
function playHighWarning(ctx: AudioContext, startTime: number) {
  // Beep 1
  playTone(ctx, 750, startTime, 0.14, 'square', 0.22)
  // Beep 2
  playTone(ctx, 750, startTime + 0.20, 0.18, 'square', 0.22)
}

/**
 * MEDIUM: Distinct advisory chime / beep (520Hz -> 660Hz ascending chime)
 */
function playMediumChime(ctx: AudioContext, startTime: number) {
  playTone(ctx, 520, startTime, 0.12, 'sine', 0.18)
  playTone(ctx, 660, startTime + 0.14, 0.22, 'sine', 0.18)
}

/**
 * INFO: Subtle notification sound / chime (440Hz soft bell)
 */
function playInfoChime(ctx: AudioContext, startTime: number) {
  playTone(ctx, 440, startTime, 0.25, 'sine', 0.12)
}

function playTone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType,
  vol: number
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, start)

  gain.gain.setValueAtTime(0.001, start)
  gain.gain.linearRampToValueAtTime(vol, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(start)
  osc.stop(start + duration)
}
