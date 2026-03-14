import http from 'http'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { WebSocketServer, WebSocket } from 'ws'
import type { PlayerId } from '../../shared/types.js'
import type { RoomState, EmojiPayload, ChatPayload } from '../../shared/protocol.js'
import { RoomManager } from './rooms.js'

const PORT = Number(process.env.PORT || 4000)
const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/

const createRoomId = (): string =>
  Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()

// ── 房间管理器 ──────────────────────────────────────────────

const rooms = new RoomManager()

// ── WebSocket 连接池 ────────────────────────────────────────

type SocketMeta = { roomId: string; seat: PlayerId; token: string }

const roomSockets = new Map<string, Set<WebSocket>>()
const socketMeta = new WeakMap<WebSocket, SocketMeta>()

const addSocket = (ws: WebSocket, meta: SocketMeta): void => {
  socketMeta.set(ws, meta)
  let sockets = roomSockets.get(meta.roomId)
  if (!sockets) {
    sockets = new Set()
    roomSockets.set(meta.roomId, sockets)
  }
  sockets.add(ws)
}

const removeSocket = (ws: WebSocket): SocketMeta | null => {
  const meta = socketMeta.get(ws)
  if (!meta) return null

  const sockets = roomSockets.get(meta.roomId)
  if (sockets) {
    sockets.delete(ws)
    if (sockets.size === 0) {
      roomSockets.delete(meta.roomId)
    }
  }
  return meta
}

/** 检查同一 seat+token 是否还有其他活跃连接 */
const hasSiblingSocket = (ws: WebSocket, meta: SocketMeta): boolean => {
  const sockets = roomSockets.get(meta.roomId)
  if (!sockets) return false

  for (const socket of sockets) {
    if (socket === ws) continue
    const otherMeta = socketMeta.get(socket)
    if (otherMeta?.seat === meta.seat && otherMeta.token === meta.token) {
      return true
    }
  }
  return false
}

/** 关闭指定 seat+token 的所有连接 */
const closeSeatSockets = (roomId: string, seat: PlayerId, token: string, code: number, reason: string): void => {
  const sockets = roomSockets.get(roomId)
  if (!sockets) return

  for (const socket of sockets) {
    const meta = socketMeta.get(socket)
    if (meta?.seat === seat && meta.token === token) {
      socket.close(code, reason)
    }
  }
}

type BroadcastEvent = { type: string; payload: unknown }

const broadcastToRoom = (roomId: string, event: BroadcastEvent): void => {
  const sockets = roomSockets.get(roomId)
  if (!sockets) return
  const encoded = JSON.stringify(event)
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encoded)
    }
  }
}

// ── Express 应用 ────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, runtime: 'node' })
})

// ── HTTP REST API ───────────────────────────────────────────

const extractRoomId = (req: Request): string => {
  const value = req.params.roomId
  return Array.isArray(value) ? value[0] : value
}

/** 统一错误处理包装器 */
const wrapHandler = (handler: (req: Request, res: Response) => Promise<void> | void) =>
  async (req: Request, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.'
      res.status(400).json({ message })
    }
  }

// 创建房间
app.post('/api/rooms', wrapHandler((_req, res) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = createRoomId()
    if (rooms.hasRoom(roomId)) continue

    const result = rooms.createRoom(roomId)
    res.status(201).json(result)
    return
  }
  res.status(500).json({ message: 'Failed to allocate a room ID.' })
}))

// 查询房间状态
app.get('/api/rooms/:roomId', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const state = rooms.getRoomState(roomId)
  if (!state) {
    res.status(404).json({ message: 'Room not found.' })
    return
  }
  res.json(state)
}))

// 加入房间
app.post('/api/rooms/:roomId/join', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const result = rooms.joinRoom(roomId)
  res.json(result)
}))

// 重连
app.post('/api/rooms/:roomId/reconnect', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token } = req.body as { token?: string }
  if (!token) {
    res.status(400).json({ message: 'token is required.' })
    return
  }

  const result = rooms.reconnect(roomId, token)
  res.json(result)
}))

// 准备
app.post('/api/rooms/:roomId/ready', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token, ready } = req.body as { token?: string; ready?: boolean }
  if (!token || typeof ready !== 'boolean') {
    res.status(400).json({ message: 'Invalid ready payload.' })
    return
  }

  const state = rooms.setReady(roomId, token, ready)
  broadcastToRoom(roomId, { type: 'room:state', payload: state })
  res.json(state)
}))

// 走子
app.post('/api/rooms/:roomId/move', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token, from, to } = req.body as { token?: string; from?: string; to?: string }
  if (!token || !from || !to) {
    res.status(400).json({ message: 'Invalid move payload.' })
    return
  }

  const state = rooms.applyMove(roomId, token, from, to)
  broadcastToRoom(roomId, { type: 'room:state', payload: state })
  res.json(state)
}))

// 表情
app.post('/api/rooms/:roomId/emoji', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token, emoji } = req.body as { token?: string; emoji?: string }
  if (!token || !emoji) {
    res.status(400).json({ message: 'Invalid emoji payload.' })
    return
  }

  const { seat } = rooms.sendEmoji(roomId, token, emoji)
  const now = Date.now()
  const eventPayload: EmojiPayload = { roomId, emoji, from: seat, at: now }
  broadcastToRoom(roomId, { type: 'emoji:receive', payload: eventPayload })
  res.status(204).end()
}))

// 聊天
app.post('/api/rooms/:roomId/chat', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token, message } = req.body as { token?: string; message?: string }
  if (!token || !message) {
    res.status(400).json({ message: 'Invalid chat payload.' })
    return
  }

  const { seat, text } = rooms.sendChat(roomId, token, message)
  const now = Date.now()
  const eventPayload: ChatPayload = { roomId, message: text, from: seat, at: now }
  broadcastToRoom(roomId, { type: 'chat:receive', payload: eventPayload })
  res.status(204).end()
}))

// 重开
app.post('/api/rooms/:roomId/restart', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token } = req.body as { token?: string }
  if (!token) {
    res.status(400).json({ message: 'token is required.' })
    return
  }

  const state = rooms.restart(roomId, token)
  broadcastToRoom(roomId, { type: 'room:state', payload: state })
  res.json(state)
}))

// 离开
app.post('/api/rooms/:roomId/leave', wrapHandler((req, res) => {
  const roomId = extractRoomId(req)
  if (!ROOM_ID_PATTERN.test(roomId)) {
    res.status(400).json({ message: 'Invalid room ID.' })
    return
  }

  const { token } = req.body as { token?: string }
  if (!token) {
    res.status(400).json({ message: 'token is required.' })
    return
  }

  const { destroyed, state, seat } = rooms.leave(roomId, token)
  closeSeatSockets(roomId, seat, token, 1000, 'Left room.')

  if (destroyed) {
    // 关闭该房间所有残留连接
    const sockets = roomSockets.get(roomId)
    if (sockets) {
      for (const ws of sockets) {
        ws.close(1001, 'Room closed.')
      }
      roomSockets.delete(roomId)
    }
    res.status(204).end()
    return
  }

  if (state) {
    broadcastToRoom(roomId, { type: 'room:state', payload: state })
  }
  res.json(state)
}))

// ── 静态文件服务 ────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientDistCandidates = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(__dirname, '../../../../client/dist'),
  path.resolve(__dirname, '../../client/dist'),
]
const clientDist = clientDistCandidates.find((candidate) => existsSync(candidate))

if (clientDist) {
  app.use(express.static(clientDist))
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

// ── HTTP 服务器 + WebSocket ─────────────────────────────────

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '', `http://${request.headers.host}`)

  if (!url.pathname.startsWith('/ws/')) {
    socket.destroy()
    return
  }

  const [, , roomId] = url.pathname.split('/')
  if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
    socket.destroy()
    return
  }

  const token = url.searchParams.get('token')
  if (!token) {
    socket.destroy()
    return
  }

  let seat: PlayerId
  try {
    seat = rooms.requireSeatByToken(roomId, token)
  } catch {
    socket.destroy()
    return
  }

  // 关闭同 seat 的旧连接
  closeSeatSockets(roomId, seat, token, 1000, 'Superseded by a newer connection.')

  wss.handleUpgrade(request, socket, head, (ws) => {
    const meta: SocketMeta = { roomId, seat, token }
    addSocket(ws, meta)

    rooms.setConnected(roomId, seat, token)

    ws.on('close', () => {
      const removedMeta = removeSocket(ws)
      if (!removedMeta) return

      // 检查是否还有同 seat+token 的其他连接
      if (!hasSiblingSocket(ws, removedMeta)) {
        rooms.setDisconnected(removedMeta.roomId, removedMeta.seat, removedMeta.token)

        const state = rooms.getRoomState(removedMeta.roomId)
        if (state) {
          broadcastToRoom(removedMeta.roomId, { type: 'room:state', payload: state })
        }
      }
    })

    // WebSocket 仅用于服务端推送，不处理客户端消息
    ws.on('message', () => {})
  })
})

// ── 定时任务（替代 Cloudflare Alarm） ───────────────────────

setInterval(() => {
  // 断线超时判负
  const timeoutUpdates = rooms.checkTimeouts()
  timeoutUpdates.forEach((state: RoomState) => {
    broadcastToRoom(state.roomId, { type: 'room:state', payload: state })
  })

  // 空房间清理
  const reaped = rooms.reapIdleRooms()
  reaped.forEach((roomId: string) => {
    const sockets = roomSockets.get(roomId)
    if (sockets) {
      for (const ws of sockets) {
        ws.close(1001, 'Room closed to conserve resources.')
      }
      roomSockets.delete(roomId)
    }
  })
}, 5000)

// ── 启动 ────────────────────────────────────────────────────

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Game-hub Node.js 服务器运行在端口 ${PORT}`)
})
