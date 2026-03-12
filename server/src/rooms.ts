import crypto from 'crypto'
import type { PlayerId, PieceMap } from '../../../shared/types.js'
import type { RoomState, RoomStatus, PlayerSlot } from '../../../shared/protocol.js'
import { createBoard, createInitialPieces } from './rules/board.js'
import { getValidMoves } from './rules/move.js'
import { getWinner } from './rules/win.js'

type InternalSlot = PlayerSlot & {
  token: string
  disconnectedAt?: number
  lastMoveAt?: number
}

type Room = {
  id: string
  status: RoomStatus
  players: Record<PlayerId, InternalSlot | null>
  pieces: PieceMap
  currentPlayer: PlayerId
  winner: PlayerId | null
  updatedAt: number
}

type PlayerIndex = {
  roomId: string
  seat: PlayerId
}

const BOARD_SIZE = 4

const createRoomId = (): string =>
  Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()

const createToken = (): string => crypto.randomUUID()

export class RoomManager {
  private rooms = new Map<string, Room>()
  private playerIndex = new Map<string, PlayerIndex>()
  private board = createBoard(BOARD_SIZE)
  private disconnectTimeoutMs = 2 * 60 * 1000

  createRoom(socketId: string): { room: Room; seat: PlayerId; token: string } {
    let roomId = createRoomId()
    while (this.rooms.has(roomId)) {
      roomId = createRoomId()
    }

    const token = createToken()
    const room: Room = {
      id: roomId,
      status: 'waiting',
      players: {
        A: { id: socketId, connected: true, ready: false, token },
        B: null,
      },
      pieces: createInitialPieces(this.board),
      currentPlayer: 'A',
      winner: null,
      updatedAt: Date.now(),
    }

    this.rooms.set(roomId, room)
    this.playerIndex.set(socketId, { roomId, seat: 'A' })
    return { room, seat: 'A', token }
  }

  joinRoom(socketId: string, roomId: string): { room: Room; seat: PlayerId; token: string } {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.players.B) {
      throw new Error('房间已满')
    }

    const token = createToken()
    room.players.B = { id: socketId, connected: true, ready: false, token }
    room.updatedAt = Date.now()
    this.playerIndex.set(socketId, { roomId, seat: 'B' })
    return { room, seat: 'B', token }
  }

  reconnect(roomId: string, token: string, socketId: string): { room: Room; seat: PlayerId } {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    const seat =
      room.players.A?.token === token ? 'A' : room.players.B?.token === token ? 'B' : null
    if (!seat) {
      throw new Error('无效的重连凭证')
    }

    const slot = room.players[seat]
    if (!slot) {
      throw new Error('玩家不存在')
    }

    this.playerIndex.delete(slot.id)
    slot.id = socketId
    slot.connected = true
    slot.disconnectedAt = undefined
    room.updatedAt = Date.now()
    this.playerIndex.set(socketId, { roomId, seat })
    return { room, seat }
  }

  leaveRoom(socketId: string, roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    const index = this.playerIndex.get(socketId)
    if (!index) {
      return
    }

    room.players[index.seat] = null
    room.updatedAt = Date.now()
    this.playerIndex.delete(socketId)

    if (!room.players.A && !room.players.B) {
      this.rooms.delete(roomId)
    }
  }

  setReady(socketId: string, roomId: string, ready: boolean): Room {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    const index = this.playerIndex.get(socketId)
    if (!index || index.roomId !== roomId) {
      throw new Error('玩家未在房间内')
    }
    const slot = room.players[index.seat]
    if (!slot) {
      throw new Error('玩家不存在')
    }
    slot.ready = ready
    room.updatedAt = Date.now()

    if (room.players.A?.ready && room.players.B?.ready) {
      room.status = 'playing'
    } else {
      room.status = 'waiting'
    }

    return room
  }

  applyMove(socketId: string, roomId: string, from: string, to: string): Room {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.status !== 'playing') {
      throw new Error('对局尚未开始')
    }
    if (room.winner) {
      throw new Error('对局已结束')
    }
    const index = this.playerIndex.get(socketId)
    if (!index || index.roomId !== roomId) {
      throw new Error('玩家未在房间内')
    }
    if (index.seat !== room.currentPlayer) {
      throw new Error('未轮到该玩家')
    }
    const slot = room.players[index.seat]
    if (!slot) {
      throw new Error('玩家不存在')
    }
    if (slot.lastMoveAt && Date.now() - slot.lastMoveAt < 200) {
      throw new Error('操作过于频繁')
    }
    const owner = room.pieces[from]
    if (owner !== index.seat) {
      throw new Error('棋子归属不匹配')
    }

    const moves = getValidMoves(from, room.pieces, this.board.positionSet)
    const valid = moves.steps.has(to) || moves.jumps.has(to)
    if (!valid) {
      throw new Error('非法走子')
    }

    const nextPieces: PieceMap = { ...room.pieces }
    delete nextPieces[from]
    nextPieces[to] = index.seat

    room.pieces = nextPieces
    room.updatedAt = Date.now()
    slot.lastMoveAt = room.updatedAt
    room.winner = getWinner(nextPieces, this.board.homeA, this.board.homeB)
    if (room.winner) {
      room.status = 'finished'
    } else {
      room.currentPlayer = index.seat === 'A' ? 'B' : 'A'
    }

    return room
  }

  markDisconnected(socketId: string) {
    const index = this.playerIndex.get(socketId)
    if (!index) {
      return
    }
    const room = this.rooms.get(index.roomId)
    if (!room) {
      return
    }
    const slot = room.players[index.seat]
    if (slot) {
      slot.connected = false
      slot.disconnectedAt = Date.now()
      room.updatedAt = Date.now()
    }
  }

  markConnected(socketId: string) {
    const index = this.playerIndex.get(socketId)
    if (!index) {
      return
    }
    const room = this.rooms.get(index.roomId)
    if (!room) {
      return
    }
    const slot = room.players[index.seat]
    if (slot) {
      slot.connected = true
      slot.disconnectedAt = undefined
      room.updatedAt = Date.now()
    }
  }

  checkTimeouts(): RoomState[] {
    const now = Date.now()
    const updated: RoomState[] = []

    this.rooms.forEach((room) => {
      if (room.status !== 'playing' || room.winner) {
        return
      }
      const seats: PlayerId[] = ['A', 'B']
      seats.forEach((seat) => {
        const slot = room.players[seat]
        if (!slot || slot.connected) {
          return
        }
        if (!slot.disconnectedAt) {
          return
        }
        if (now - slot.disconnectedAt > this.disconnectTimeoutMs) {
          room.winner = seat === 'A' ? 'B' : 'A'
          room.status = 'finished'
          room.updatedAt = now
          updated.push(this.toRoomState(room))
        }
      })
    })

    return updated
  }

  getRoomState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId)
    if (!room) {
      return null
    }
    return this.toRoomState(room)
  }

  getRoomStateBySocket(socketId: string): RoomState | null {
    const index = this.playerIndex.get(socketId)
    if (!index) {
      return null
    }
    const room = this.rooms.get(index.roomId)
    if (!room) {
      return null
    }
    return this.toRoomState(room)
  }

  getSeat(socketId: string, roomId: string): PlayerId | null {
    const index = this.playerIndex.get(socketId)
    if (!index || index.roomId !== roomId) {
      return null
    }
    return index.seat
  }

  private toRoomState(room: Room): RoomState {
    return {
      roomId: room.id,
      status: room.status,
      players: {
        A: room.players.A
          ? {
              id: room.players.A.id,
              connected: room.players.A.connected,
              ready: room.players.A.ready,
            }
          : null,
        B: room.players.B
          ? {
              id: room.players.B.id,
              connected: room.players.B.connected,
              ready: room.players.B.ready,
            }
          : null,
      },
      currentPlayer: room.currentPlayer,
      pieces: room.pieces,
      winner: room.winner,
      updatedAt: room.updatedAt,
    }
  }
}
