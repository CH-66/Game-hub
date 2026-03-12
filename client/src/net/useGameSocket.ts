import { useEffect, useMemo, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomState,
  EmojiPayload,
  ChatPayload,
} from '@shared/protocol'
import type { PlayerId } from '@shared/types'

type UseGameSocket = {
  roomState: RoomState | null
  seat: PlayerId | null
  error: string | null
  connected: boolean
  hasSession: boolean
  emojiFeed: EmojiPayload[]
  chatFeed: ChatPayload[]
  createRoom: () => void
  joinRoom: (roomId: string) => void
  leaveRoom: (roomId: string) => void
  setReady: (roomId: string, ready: boolean) => void
  sendMove: (roomId: string, from: string, to: string) => void
  sendEmoji: (roomId: string, emoji: string) => void
  sendChat: (roomId: string, message: string) => void
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
  const [chatFeed, setChatFeed] = useState<ChatPayload[]>([])

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = useMemo(
    () => io(url, { autoConnect: false }),
    [url],
  )

  useEffect(() => {
    const handleConnect = () => setConnected(true)
    const handleDisconnect = () => setConnected(false)
    const handleRoomState = (state: RoomState) => {
      setRoomState(state)
    }
    const handleRoomJoined = (payload: { roomId: string; seat: PlayerId; token: string }) => {
      setSeat(payload.seat)
      writeSession(payload.roomId, payload.token)
      setHasSession(true)
    }
    const handleRoomError = (payload: { message: string }) => {
      setError(payload.message)
    }
    const handleEmoji = (payload: EmojiPayload) => {
      setEmojiFeed((prev) => {
        const next = [payload, ...prev]
        return next.slice(0, 6)
      })
      setChatFeed((prev) => {
        const next = [...prev, { roomId: payload.roomId, message: payload.emoji, from: payload.from, at: payload.at }]
        return next.slice(-100)
      })
    }
    const handleChat = (payload: ChatPayload) => {
      setChatFeed((prev) => {
        const next = [...prev, payload]
        return next.slice(-100)
      })
    }

    socket.connect()
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('room:state', handleRoomState)
    socket.on('room:joined', handleRoomJoined)
    socket.on('room:error', handleRoomError)
    socket.on('emoji:receive', handleEmoji)
    socket.on('chat:receive', handleChat)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('room:state', handleRoomState)
      socket.off('room:joined', handleRoomJoined)
      socket.off('room:error', handleRoomError)
      socket.off('emoji:receive', handleEmoji)
      socket.off('chat:receive', handleChat)
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

  const sendChat = (roomId: string, message: string) => {
    socket.emit('chat:send', { roomId, message })
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
    chatFeed,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    sendMove,
    sendEmoji,
    sendChat,
    restartRoom,
    reconnect,
  }
}
