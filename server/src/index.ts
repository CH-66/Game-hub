import http from 'http'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js'
import { RoomManager } from './rooms.js'

const PORT = Number(process.env.PORT || 4000)

const app = express()
app.use(cors())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

const rooms = new RoomManager()
const ALLOWED_EMOJIS = ['🎉', '🔥', '😎', '👏', '😅', '👀']

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
    if (!ALLOWED_EMOJIS.includes(emoji)) {
      socket.emit('room:error', { message: '非法表情' })
      return
    }
    io.to(roomId).emit('emoji:receive', { roomId, emoji, from: seat, at: Date.now() })
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
