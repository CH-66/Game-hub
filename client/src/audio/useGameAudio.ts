import { useCallback, useEffect, useRef, useState } from 'react'

type SoundName = 'select' | 'move' | 'jump' | 'turn' | 'emoji' | 'win'
type ToneStep = {
  frequency: number
  duration: number
  gain: number
  type: OscillatorType
  offset?: number
}

const SOUND_MAP: Record<SoundName, ToneStep[]> = {
  select: [{ frequency: 720, duration: 0.08, gain: 0.035, type: 'triangle' }],
  move: [
    { frequency: 420, duration: 0.09, gain: 0.04, type: 'sine' },
    { frequency: 560, duration: 0.08, gain: 0.03, type: 'triangle', offset: 0.06 },
  ],
  jump: [
    { frequency: 360, duration: 0.08, gain: 0.045, type: 'triangle' },
    { frequency: 520, duration: 0.08, gain: 0.04, type: 'triangle', offset: 0.06 },
    { frequency: 700, duration: 0.12, gain: 0.03, type: 'sine', offset: 0.12 },
  ],
  turn: [
    { frequency: 560, duration: 0.1, gain: 0.04, type: 'sine' },
    { frequency: 760, duration: 0.14, gain: 0.035, type: 'triangle', offset: 0.08 },
  ],
  emoji: [
    { frequency: 660, duration: 0.07, gain: 0.03, type: 'triangle' },
    { frequency: 880, duration: 0.09, gain: 0.02, type: 'triangle', offset: 0.05 },
  ],
  win: [
    { frequency: 520, duration: 0.12, gain: 0.045, type: 'triangle' },
    { frequency: 660, duration: 0.12, gain: 0.04, type: 'triangle', offset: 0.1 },
    { frequency: 880, duration: 0.2, gain: 0.035, type: 'sine', offset: 0.2 },
  ],
}

const getAudioContextCtor = (): typeof AudioContext | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null
}

export const useGameAudio = () => {
  const [soundEnabled, setSoundEnabled] = useState(true)
  const contextRef = useRef<AudioContext | null>(null)
  const outputRef = useRef<GainNode | null>(null)

  const ensureContext = useCallback(() => {
    const AudioContextCtor = getAudioContextCtor()
    if (!AudioContextCtor) {
      return null
    }

    if (!contextRef.current) {
      const context = new AudioContextCtor()
      const output = context.createGain()
      output.gain.value = 0.9
      output.connect(context.destination)
      contextRef.current = context
      outputRef.current = output
    }

    return contextRef.current
  }, [])

  const unlockAudio = useCallback(() => {
    if (!soundEnabled) {
      return
    }

    const context = ensureContext()
    if (context?.state === 'suspended') {
      void context.resume()
    }
  }, [ensureContext, soundEnabled])

  const playSound = useCallback((name: SoundName) => {
    if (!soundEnabled) {
      return
    }

    const context = ensureContext()
    const output = outputRef.current
    if (!context || !output || context.state !== 'running') {
      return
    }

    const startTime = context.currentTime
    SOUND_MAP[name].forEach((step) => {
      const oscillator = context.createOscillator()
      const gainNode = context.createGain()
      const noteStart = startTime + (step.offset ?? 0)
      const noteEnd = noteStart + step.duration

      oscillator.type = step.type
      oscillator.frequency.setValueAtTime(step.frequency, noteStart)

      gainNode.gain.setValueAtTime(0.0001, noteStart)
      gainNode.gain.exponentialRampToValueAtTime(step.gain, noteStart + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEnd)

      oscillator.connect(gainNode)
      gainNode.connect(output)
      oscillator.start(noteStart)
      oscillator.stop(noteEnd + 0.02)
    })
  }, [ensureContext, soundEnabled])

  const toggleSound = useCallback(() => {
    setSoundEnabled((previous) => {
      const next = !previous
      if (next) {
        const context = ensureContext()
        if (context?.state === 'suspended') {
          void context.resume()
        }
      }
      return next
    })
  }, [ensureContext])

  useEffect(() => {
    return () => {
      const context = contextRef.current
      contextRef.current = null
      outputRef.current = null
      if (context) {
        void context.close()
      }
    }
  }, [])

  return {
    soundEnabled,
    unlockAudio,
    playSound,
    toggleSound,
  }
}
