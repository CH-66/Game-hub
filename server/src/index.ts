import http from 'http'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { EMOJI_LIST } from '../../shared/emojis.js'
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js'
import { RoomManager } from './rooms.js'

const PORT = Number(process.env.PORT || 4000)

const app = express()
app.use(cors())

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

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
} else {
  // Keep the API server bootable even if frontend assets were not built yet.
  app.get('*', (_req: Request, res: Response) => {
    res.status(503).json({ message: 'client build not found' })
  })
}

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

const rooms = new RoomManager()
const MAX_CHAT_LENGTH = 120
const EMOJI_COOLDOWN_MS = 1200
const CHAT_COOLDOWN_MS = 900
const isAllowedEmoji = (value: string): boolean => EMOJI_LIST.some((emoji) => emoji === value)
const lastEmojiAtBySocket = new Map<string, number>()
const lastChatAtBySocket = new Map<string, number>()

setInterval(() => {
  const updates = rooms.checkTimeouts()
  updates.forEach((state) => {
    io.to(state.roomId).emit('room:state', state)
  })
}, 5000)

io.on('connection', (socket) => {
  rooms.markConnected(socket.id)

  socket.on('room:create', () => {
    try {
      const { room, seat, token } = rooms.createRoom(socket.id)
      socket.join(room.id)
      socket.emit('room:joined', { roomId: room.id, seat, token })
      io.to(room.id).emit('room:state', rooms.getRoomState(room.id)!)
    } catch (error) {
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('room:join', ({ roomId }) => {
    try {
      const { room, seat, token } = rooms.joinRoom(socket.id, roomId)
      socket.join(room.id)
      socket.emit('room:joined', { roomId: room.id, seat, token })
      io.to(room.id).emit('room:state', rooms.getRoomState(room.id)!)
    } catch (error) {
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('room:reconnect', ({ roomId, token }) => {
    try {
      const { room, seat } = rooms.reconnect(roomId, token, socket.id)
      socket.join(room.id)
      socket.emit('room:joined', { roomId: room.id, seat, token })
      io.to(room.id).emit('room:state', rooms.getRoomState(room.id)!)
    } catch (error) {
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('room:ready', ({ roomId, ready }) => {
    try {
      const room = rooms.setReady(socket.id, roomId, ready)
      io.to(room.id).emit('room:state', rooms.getRoomState(room.id)!)
    } catch (error) {
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('move:intent', ({ roomId, from, to }) => {
    try {
      const room = rooms.applyMove(socket.id, roomId, from, to)
      io.to(room.id).emit('room:state', rooms.getRoomState(room.id)!)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[move:intent]', (error as Error).message)
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('emoji:send', ({ roomId, emoji }) => {
    const seat = rooms.getSeat(socket.id, roomId)
    if (!seat) {
      socket.emit('room:error', { message: '玩家未在房间内' })
      return
    }
    if (!isAllowedEmoji(emoji)) {
      socket.emit('room:error', { message: '非法表情' })
      return
    }
    const now = Date.now()
    const lastEmojiAt = lastEmojiAtBySocket.get(socket.id) ?? 0
    if (now - lastEmojiAt < EMOJI_COOLDOWN_MS) {
      socket.emit('room:error', { message: '表情发送过于频繁' })
      return
    }
    lastEmojiAtBySocket.set(socket.id, now)
    io.to(roomId).emit('emoji:receive', { roomId, emoji, from: seat, at: now })
  })

  socket.on('chat:send', ({ roomId, message }) => {
    const seat = rooms.getSeat(socket.id, roomId)
    if (!seat) {
      socket.emit('room:error', { message: '玩家未在房间内' })
      return
    }
    const text = message.trim()
    if (!text) {
      return
    }
    const now = Date.now()
    const lastChatAt = lastChatAtBySocket.get(socket.id) ?? 0
    if (now - lastChatAt < CHAT_COOLDOWN_MS) {
      socket.emit('room:error', { message: '消息发送过于频繁' })
      return
    }
    if (text.length > MAX_CHAT_LENGTH) {
      socket.emit('room:error', { message: '消息过长' })
      return
    }
    lastChatAtBySocket.set(socket.id, now)
    io.to(roomId).emit('chat:receive', { roomId, message: text, from: seat, at: now })
  })

  socket.on('room:restart', ({ roomId }) => {
    try {
      rooms.restart(roomId)
      io.to(roomId).emit('room:state', rooms.getRoomState(roomId)!)
    } catch (error) {
      socket.emit('room:error', { message: (error as Error).message })
    }
  })

  socket.on('room:leave', ({ roomId }) => {
    rooms.leaveRoom(socket.id, roomId)
    const state = rooms.getRoomState(roomId)
    if (state) {
      io.to(roomId).emit('room:state', state)
    }
    socket.leave(roomId)
  })

  socket.on('disconnect', () => {
    lastEmojiAtBySocket.delete(socket.id)
    lastChatAtBySocket.delete(socket.id)
    rooms.markDisconnected(socket.id)
    const state = rooms.getRoomStateBySocket(socket.id)
    if (state) {
      io.to(state.roomId).emit('room:state', state)
    }
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket.IO server running on ${PORT}`)
})
