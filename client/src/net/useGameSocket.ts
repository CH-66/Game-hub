import { useEffect, useMemo, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomState,
  EmojiPayload,
} from '@shared/protocol'
import type { PlayerId } from '@shared/types'

type UseGameSocket = {
  roomState: RoomState | null
  seat: PlayerId | null
  error: string | null
  connected: boolean
  hasSession: boolean
  emojiFeed: EmojiPayload[]
  createRoom: () => void
  joinRoom: (roomId: string) => void
  leaveRoom: (roomId: string) => void
  setReady: (roomId: string, ready: boolean) => void
  sendMove: (roomId: string, from: string, to: string) => void
  sendEmoji: (roomId: string, emoji: string) => void
  restartRoom: (roomId: string) => void
  reconnect: () => void
}

const STORAGE_KEY = 'cc_session'

const readSession = (): { roomId: string; token: string } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { roomId?: string; token?: string }
    if (!parsed.roomId || !parsed.token) {
      return null
    }
    return { roomId: parsed.roomId, token: parsed.token }
  } catch {
    return null
  }
}

const writeSession = (roomId: string, token: string) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, token }))
}

const clearSession = () => {
  localStorage.removeItem(STORAGE_KEY)
}

export const useGameSocket = (url: string): UseGameSocket => {
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [seat, setSeat] = useState<PlayerId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [hasSession, setHasSession] = useState(() => Boolean(readSession()))
  const [emojiFeed, setEmojiFeed] = useState<EmojiPayload[]>([])

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = useMemo(
    () => io(url, { autoConnect: false }),
    [url],
  )

  useEffect(() => {
    socket.connect()
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('room:state', (state) => {
      setRoomState(state)
    })
    socket.on('room:joined', (payload) => {
      setSeat(payload.seat)
      writeSession(payload.roomId, payload.token)
      setHasSession(true)
    })
    socket.on('room:error', (payload) => {
      setError(payload.message)
    })
    socket.on('emoji:receive', (payload) => {
      setEmojiFeed((prev) => {
        const next = [payload, ...prev]
        return next.slice(0, 6)
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [socket])

  const reconnect = () => {
    const session = readSession()
    if (!session) {
      return
    }
    socket.emit('room:reconnect', session)
  }

  const createRoom = () => {
    setError(null)
    socket.emit('room:create')
  }

  const joinRoom = (roomId: string) => {
    setError(null)
    socket.emit('room:join', { roomId })
  }

  const leaveRoom = (roomId: string) => {
    socket.emit('room:leave', { roomId })
    setRoomState(null)
    setSeat(null)
    clearSession()
    setHasSession(false)
  }

  const setReady = (roomId: string, ready: boolean) => {
    socket.emit('room:ready', { roomId, ready })
  }

  const sendMove = (roomId: string, from: string, to: string) => {
    socket.emit('move:intent', { roomId, from, to })
  }

  const sendEmoji = (roomId: string, emoji: string) => {
    socket.emit('emoji:send', { roomId, emoji })
  }

  const restartRoom = (roomId: string) => {
    socket.emit('room:restart', { roomId })
  }

  return {
    roomState,
    seat,
    error,
    connected,
    hasSession,
    emojiFeed,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    sendMove,
    sendEmoji,
    restartRoom,
    reconnect,
  }
}
