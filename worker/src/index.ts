import { GameRoom } from './game-room.js'

type Env = {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace<GameRoom>
}

type LocationHint = 'wnam' | 'enam' | 'sam' | 'weur' | 'eeur' | 'apac' | 'oc' | 'afr' | 'me'

const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/

const json = (payload: unknown, init?: ResponseInit): Response =>
  Response.json(payload, init)

const createRoomId = (): string =>
  Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()

const getRoomStub = (
  env: Env,
  roomId: string,
  options?: { locationHint?: LocationHint },
): DurableObjectStub<GameRoom> => {
  const durableObjectId = env.ROOMS.idFromName(roomId)
  return env.ROOMS.get(durableObjectId, options)
}

const forwardToRoom = (
  env: Env,
  roomId: string,
  request: Request,
  pathname: string,
  init?: RequestInit,
  stubOptions?: { locationHint?: LocationHint },
): Promise<Response> => {
  const stub = getRoomStub(env, roomId, stubOptions)
  const normalizedPath = pathname.startsWith('/') ? pathname.slice(1) : pathname
  const forwardedRequest = new Request(`https://room/${normalizedPath}`, init ?? request)
  return stub.fetch(forwardedRequest)
}

export { GameRoom }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, runtime: 'cloudflare-workers' })
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const roomId = createRoomId()
        const response = await forwardToRoom(env, roomId, request, '/create', {
          method: 'POST',
          headers: {
            'x-room-id': roomId,
          },
        }, { locationHint: 'apac' })

        if (response.ok) {
          return response
        }
      }

      return json({ message: 'Failed to allocate a room ID.' }, { status: 500 })
    }

    if (url.pathname.startsWith('/api/rooms/')) {
      const [, , , roomId, action] = url.pathname.split('/')
      if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
        return json({ message: 'Invalid room ID.' }, { status: 400 })
      }

      if (request.method === 'GET' && !action) {
        return forwardToRoom(env, roomId, request, '/state')
      }

      const actionMap: Record<string, string> = {
        join: '/join',
        reconnect: '/reconnect',
        ready: '/ready',
        move: '/move',
        emoji: '/emoji',
        chat: '/chat',
        restart: '/restart',
        leave: '/leave',
      }

      const targetPath = action ? actionMap[action] : null
      if (!targetPath) {
        return json({ message: 'Unknown room action.' }, { status: 404 })
      }

      return forwardToRoom(env, roomId, request, targetPath)
    }

    if (url.pathname.startsWith('/ws/')) {
      const [, , roomId] = url.pathname.split('/')
      if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
        return json({ message: 'Invalid room ID.' }, { status: 400 })
      }

      return getRoomStub(env, roomId).fetch(request)
    }

    return env.ASSETS.fetch(request)
  },
}
