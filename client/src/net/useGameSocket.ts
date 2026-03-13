import { useEffect, useRef, useState } from 'react'
import type { ChatPayload, EmojiPayload, RoomJoinedPayload, RoomState, ServerEvent } from '@shared/protocol'
import type { PlayerId } from '@shared/types'

type UseGameSocket = {
  roomState: RoomState | null
  seat: PlayerId | null
  error: string | null
  connected: boolean
  hasSession: boolean
  emojiFeed: Array<EmojiPayload & { localId: string }>
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

type Session = {
  roomId: string
  token: string
}

type ApiError = {
  message: string
}

const STORAGE_KEY = 'cc_session'

const readSession = (): Session | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Session>
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

const getHttpBaseUrl = (value: string): URL => new URL(value, window.location.origin)

const getWsBaseUrl = (value: string): URL => {
  const url = getHttpBaseUrl(value)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

const isApiError = (value: unknown): value is ApiError =>
  typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'

export const useGameSocket = (url: string): UseGameSocket => {
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [seat, setSeat] = useState<PlayerId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [hasSession, setHasSession] = useState(() => Boolean(readSession()))
  const [emojiFeed, setEmojiFeed] = useState<Array<EmojiPayload & { localId: string }>>([])
  const [chatFeed, setChatFeed] = useState<ChatPayload[]>([])

  const socketRef = useRef<WebSocket | null>(null)
  const emojiCounterRef = useRef(0)
  const httpBaseUrlRef = useRef(getHttpBaseUrl(url))
  const wsBaseUrlRef = useRef(getWsBaseUrl(url))

  useEffect(() => {
    httpBaseUrlRef.current = getHttpBaseUrl(url)
    wsBaseUrlRef.current = getWsBaseUrl(url)
  }, [url])

  useEffect(() => {
    return () => {
      socketRef.current?.close(1000, 'Component unmounted.')
      socketRef.current = null
    }
  }, [])

  const requestJson = async <TResponse>(pathname: string, payload?: unknown): Promise<TResponse> => {
    const requestUrl = new URL(pathname, httpBaseUrlRef.current)
    const response = await fetch(requestUrl, {
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? {
            'content-type': 'application/json',
          }
        : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    })

    if (response.status === 204) {
      return undefined as TResponse
    }

    const json = (await response.json().catch(() => null)) as TResponse | ApiError | null
    if (!response.ok) {
      throw new Error(isApiError(json) ? json.message : 'Request failed.')
    }
    return json as TResponse
  }

  const refreshRoomState = (roomId: string) => {
    void requestJson<RoomState>(`/api/rooms/${roomId}`)
      .then((state) => {
        setRoomState(state)
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to load room state.',
        )
      })
  }

  const setRoomSession = (payload: RoomJoinedPayload) => {
    setSeat(payload.seat)
    writeSession(payload.roomId, payload.token)
    setHasSession(true)
  }

  const resetFeeds = () => {
    setEmojiFeed([])
    setChatFeed([])
  }

  const handleServerEvent = (event: ServerEvent) => {
    switch (event.type) {
      case 'room:state':
        setRoomState(event.payload)
        break
      case 'room:error':
        setError(event.payload.message)
        break
      case 'emoji:receive':
        emojiCounterRef.current += 1
        setEmojiFeed((previous) => {
          const next = [
            {
              ...event.payload,
              localId: `emoji-${event.payload.at}-${emojiCounterRef.current}`,
            },
            ...previous,
          ]
          return next.slice(0, 6)
        })
        setChatFeed((previous) => {
          const next = [
            ...previous,
            {
              roomId: event.payload.roomId,
              message: event.payload.emoji,
              from: event.payload.from,
              at: event.payload.at,
            },
          ]
          return next.slice(-100)
        })
        break
      case 'chat:receive':
        setChatFeed((previous) => {
          const next = [...previous, event.payload]
          return next.slice(-100)
        })
        break
    }
  }

  const connectSocket = (roomId: string, token: string) => {
    socketRef.current?.close(1000, 'Opening a new room connection.')

    const wsUrl = new URL(`/ws/${roomId}`, wsBaseUrlRef.current)
    wsUrl.searchParams.set('token', token)

    const socket = new WebSocket(wsUrl.toString())
    socketRef.current = socket
    setConnected(false)

    socket.addEventListener('open', () => {
      if (socketRef.current === socket) {
        setConnected(true)
        refreshRoomState(roomId)
      }
    })

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        setConnected(false)
      }
    })

    socket.addEventListener('error', () => {
      if (socketRef.current === socket) {
        setConnected(false)
        setError('WebSocket connection failed.')
      }
    })

    socket.addEventListener('message', (messageEvent) => {
      try {
        const parsed = JSON.parse(String(messageEvent.data)) as ServerEvent
        handleServerEvent(parsed)
      } catch {
        setError('Received an invalid realtime event.')
      }
    })
  }

  const withSession = async <TResult>(
    roomId: string,
    factory: (session: Session) => Promise<TResult>,
  ): Promise<TResult | null> => {
    const session = readSession()
    if (!session || session.roomId !== roomId) {
      setError('Missing room session.')
      return null
    }
    return factory(session)
  }

  const createRoom = () => {
    setError(null)
    void requestJson<RoomJoinedPayload>('/api/rooms', {})
      .then((payload) => {
        resetFeeds()
        setRoomSession(payload)
        connectSocket(payload.roomId, payload.token)
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to create room.')
      })
  }

  const joinRoom = (roomId: string) => {
    setError(null)
    void requestJson<RoomJoinedPayload>(`/api/rooms/${roomId}/join`, { roomId })
      .then((payload) => {
        resetFeeds()
        setRoomSession(payload)
        connectSocket(payload.roomId, payload.token)
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to join room.')
      })
  }

  const reconnect = () => {
    const session = readSession()
    if (!session) {
      return
    }

    setError(null)
    void requestJson<RoomJoinedPayload>(`/api/rooms/${session.roomId}/reconnect`, session)
      .then((payload) => {
        setRoomSession(payload)
        connectSocket(payload.roomId, payload.token)
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to reconnect.')
      })
  }

  const leaveRoom = (roomId: string) => {
    setError(null)
    void withSession(roomId, async (session) => {
      await requestJson(`/api/rooms/${roomId}/leave`, session)
      socketRef.current?.close(1000, 'Left room.')
      socketRef.current = null
      setConnected(false)
      setRoomState(null)
      setSeat(null)
      resetFeeds()
      clearSession()
      setHasSession(false)
    }).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'Failed to leave room.')
    })
  }

  const setReady = (roomId: string, ready: boolean) => {
    setError(null)
    void withSession(roomId, (session) =>
      requestJson<RoomState>(`/api/rooms/${roomId}/ready`, { ...session, ready, roomId }),
    )
      .then((state) => {
        if (state) {
          setRoomState(state)
        }
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to update ready state.')
      })
  }

  const sendMove = (roomId: string, from: string, to: string) => {
    setError(null)
    void withSession(roomId, (session) =>
      requestJson<RoomState>(`/api/rooms/${roomId}/move`, { ...session, roomId, from, to }),
    )
      .then((state) => {
        if (state) {
          setRoomState(state)
        }
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to submit move.')
      })
  }

  const sendEmoji = (roomId: string, emoji: string) => {
    setError(null)
    void withSession(roomId, (session) =>
      requestJson(`/api/rooms/${roomId}/emoji`, { ...session, roomId, emoji }),
    ).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'Failed to send emoji.')
    })
  }

  const sendChat = (roomId: string, message: string) => {
    setError(null)
    void withSession(roomId, (session) =>
      requestJson(`/api/rooms/${roomId}/chat`, { ...session, roomId, message }),
    ).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'Failed to send chat.')
    })
  }

  const restartRoom = (roomId: string) => {
    setError(null)
    void withSession(roomId, (session) =>
      requestJson<RoomState>(`/api/rooms/${roomId}/restart`, { ...session, roomId }),
    )
      .then((state) => {
        if (state) {
          setRoomState(state)
        }
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : 'Failed to restart room.')
      })
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
