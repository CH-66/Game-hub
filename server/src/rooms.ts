import crypto from 'crypto'
import type { PlayerId, PieceMap } from '../../shared/types.js'
import type { RoomState, RoomStatus } from '../../shared/protocol.js'
import { EMOJI_LIST } from '../../shared/emojis.js'
import { createBoard, createInitialPieces } from './rules/board.js'
import { getValidMoves } from './rules/move.js'
import { getWinner } from './rules/win.js'

type InternalSlot = {
  id: string
  connected: boolean
  ready: boolean
  token: string
  disconnectedAt?: number
  lastMoveAt?: number
  lastEmojiAt?: number
  lastChatAt?: number
}

type Room = {
  id: string
  status: RoomStatus
  players: Record<PlayerId, InternalSlot | null>
  pieces: PieceMap
  currentPlayer: PlayerId
  winner: PlayerId | null
  startedAt: number | null
  endedAt: number | null
  moveCount: number
  updatedAt: number
}

const BOARD_SIZE = 4
const DISCONNECT_TIMEOUT_MS = 10 * 60 * 1000
const EMPTY_ROOM_GRACE_MS = 30 * 1000
const MAX_CHAT_LENGTH = 120
const EMOJI_COOLDOWN_MS = 1200
const CHAT_COOLDOWN_MS = 900

const createToken = (): string => crypto.randomUUID()

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private board = createBoard(BOARD_SIZE)

  createRoom(roomId: string): { roomId: string; seat: PlayerId; token: string } {
    assert(!this.rooms.has(roomId), 'Room already exists.')

    const token = createToken()
    const room: Room = {
      id: roomId,
      status: 'waiting',
      players: {
        A: { id: 'A', connected: false, ready: false, token },
        B: null,
      },
      pieces: createInitialPieces(this.board),
      currentPlayer: 'A',
      winner: null,
      startedAt: null,
      endedAt: null,
      moveCount: 0,
      updatedAt: Date.now(),
    }

    this.rooms.set(roomId, room)
    return { roomId, seat: 'A', token }
  }

  joinRoom(roomId: string): { roomId: string; seat: PlayerId; token: string } {
    const room = this.requireRoom(roomId)
    const seat = room.players.A ? (room.players.B ? null : 'B') : 'A'
    assert(seat, 'Room is full.')

    const token = createToken()
    room.players[seat] = {
      id: seat,
      connected: false,
      ready: false,
      token,
    }
    room.updatedAt = Date.now()

    return { roomId: room.id, seat, token }
  }

  reconnect(roomId: string, token: string): { roomId: string; seat: PlayerId; token: string } {
    const room = this.requireRoom(roomId)
    const seat = this.findSeatByToken(room, token)
    assert(seat, 'Invalid session token.')

    return { roomId: room.id, seat, token }
  }

  setReady(roomId: string, token: string, ready: boolean): RoomState {
    const room = this.requireRoom(roomId)
    const seat = this.assertSeatByToken(room, token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    slot.ready = ready
    room.updatedAt = Date.now()

    if (room.players.A?.ready && room.players.B?.ready) {
      room.status = 'playing'
      room.startedAt = Date.now()
      room.endedAt = null
      room.moveCount = 0
      room.winner = null
    } else {
      room.status = 'waiting'
    }

    return this.toRoomState(room)
  }

  applyMove(roomId: string, token: string, from: string, to: string): RoomState {
    const room = this.requireRoom(roomId)
    assert(room.status === 'playing', 'The match has not started yet.')
    assert(!room.winner, 'The match is already finished.')

    const seat = this.assertSeatByToken(room, token)
    assert(seat === room.currentPlayer, 'It is not your turn.')

    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    if (slot.lastMoveAt && Date.now() - slot.lastMoveAt < 200) {
      throw new Error('Too many move attempts.')
    }

    const owner = room.pieces[from]
    assert(owner === seat, 'The selected piece does not belong to you.')

    const moves = getValidMoves(from, room.pieces, this.board.positionSet)
    const isValid = moves.steps.has(to) || moves.jumps.has(to)
    assert(isValid, 'Illegal move.')

    const nextPieces: PieceMap = { ...room.pieces }
    delete nextPieces[from]
    nextPieces[to] = seat

    room.pieces = nextPieces
    room.updatedAt = Date.now()
    room.moveCount += 1
    slot.lastMoveAt = room.updatedAt
    room.winner = getWinner(nextPieces, this.board.homeA, this.board.homeB)

    if (room.winner) {
      room.status = 'finished'
      room.endedAt = Date.now()
    } else {
      room.currentPlayer = seat === 'A' ? 'B' : 'A'
    }

    return this.toRoomState(room)
  }

  sendEmoji(roomId: string, token: string, emoji: string): { seat: PlayerId } {
    const room = this.requireRoom(roomId)
    const seat = this.assertSeatByToken(room, token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')
    assert((EMOJI_LIST as readonly string[]).includes(emoji), 'Unsupported emoji.')

    const now = Date.now()
    if (slot.lastEmojiAt && now - slot.lastEmojiAt < EMOJI_COOLDOWN_MS) {
      throw new Error('Emoji cooldown is active.')
    }
    slot.lastEmojiAt = now

    return { seat }
  }

  sendChat(roomId: string, token: string, message: string): { seat: PlayerId; text: string } {
    const room = this.requireRoom(roomId)
    const seat = this.assertSeatByToken(room, token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    const text = message.trim()
    assert(text.length > 0, 'Message cannot be empty.')
    assert(text.length <= MAX_CHAT_LENGTH, 'Message is too long.')

    const now = Date.now()
    if (slot.lastChatAt && now - slot.lastChatAt < CHAT_COOLDOWN_MS) {
      throw new Error('Chat cooldown is active.')
    }
    slot.lastChatAt = now

    return { seat, text }
  }

  restart(roomId: string, token: string): RoomState {
    const room = this.requireRoom(roomId)
    this.assertSeatByToken(room, token)

    room.status = 'waiting'
    room.pieces = createInitialPieces(this.board)
    room.currentPlayer = 'A'
    room.winner = null
    room.startedAt = null
    room.endedAt = null
    room.moveCount = 0
    room.updatedAt = Date.now()

    ;(['A', 'B'] as const).forEach((s) => {
      const slot = room.players[s]
      if (slot) {
        slot.ready = false
      }
    })

    return this.toRoomState(room)
  }

  leave(roomId: string, token: string): { destroyed: boolean; state: RoomState | null; seat: PlayerId } {
    const room = this.requireRoom(roomId)
    const seat = this.assertSeatByToken(room, token)

    room.players[seat] = null
    room.updatedAt = Date.now()

    if (!room.players.A && !room.players.B) {
      this.rooms.delete(roomId)
      return { destroyed: true, state: null, seat }
    }

    if (room.status === 'playing') {
      room.status = 'finished'
      room.winner = seat === 'A' ? 'B' : 'A'
      room.endedAt = Date.now()
    }

    return { destroyed: false, state: this.toRoomState(room), seat }
  }

  /** 验证 token 并返回对应座位（公开接口，按 roomId） */
  requireSeatByToken(roomId: string, token: string): PlayerId {
    const room = this.requireRoom(roomId)
    return this.assertSeatByToken(room, token)
  }

  /** 标记玩家已连接 */
  setConnected(roomId: string, seat: PlayerId, token: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    const slot = room.players[seat]
    if (!slot || slot.token !== token) return

    slot.connected = true
    slot.disconnectedAt = undefined
    room.updatedAt = Date.now()
  }

  /** 标记玩家已断线 */
  setDisconnected(roomId: string, seat: PlayerId, token: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    const slot = room.players[seat]
    if (!slot || slot.token !== token) return

    slot.connected = false
    slot.disconnectedAt = Date.now()
    room.updatedAt = Date.now()
  }

  /** 检查断线超时，返回需要广播的房间状态列表 */
  checkTimeouts(): RoomState[] {
    const now = Date.now()
    const updated: RoomState[] = []

    this.rooms.forEach((room) => {
      if (room.status !== 'playing' || room.winner) {
        return
      }

      ;(['A', 'B'] as const).forEach((seat) => {
        const slot = room.players[seat]
        if (!slot || slot.connected || !slot.disconnectedAt) {
          return
        }
        if (now - slot.disconnectedAt > DISCONNECT_TIMEOUT_MS) {
          room.winner = seat === 'A' ? 'B' : 'A'
          room.status = 'finished'
          room.endedAt = now
          room.updatedAt = now
          updated.push(this.toRoomState(room))
        }
      })
    })

    return updated
  }

  /** 清理所有玩家断线超过 30 秒的空房间，返回被清理的 roomId 列表 */
  reapIdleRooms(): string[] {
    const now = Date.now()
    const reaped: string[] = []

    this.rooms.forEach((room, roomId) => {
      const hasConnected = (['A', 'B'] as const).some((s) => room.players[s]?.connected)
      if (hasConnected) return

      const disconnectedTimes = (['A', 'B'] as const)
        .map((s) => room.players[s]?.disconnectedAt)
        .filter((t): t is number => typeof t === 'number')

      if (disconnectedTimes.length === 0) {
        // 无玩家槽位或无断线时间记录（可能两个槽位都是 null）
        // 对于两个槽位都为 null 的空房间也清理
        const hasAnyPlayer = room.players.A || room.players.B
        if (!hasAnyPlayer) {
          reaped.push(roomId)
        }
        return
      }

      const lastDisconnectedAt = Math.max(...disconnectedTimes)
      if (now - lastDisconnectedAt >= EMPTY_ROOM_GRACE_MS) {
        reaped.push(roomId)
      }
    })

    reaped.forEach((roomId) => this.rooms.delete(roomId))
    return reaped
  }

  getRoomState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    return this.toRoomState(room)
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId)
  }

  private requireRoom(roomId: string): Room {
    const room = this.rooms.get(roomId)
    assert(room, 'Room not found.')
    return room
  }

  private assertSeatByToken(room: Room, token: string): PlayerId {
    const seat = this.findSeatByToken(room, token)
    assert(seat, 'Invalid session token.')
    return seat
  }

  private findSeatByToken(room: Room, token: string): PlayerId | null {
    if (room.players.A?.token === token) return 'A'
    if (room.players.B?.token === token) return 'B'
    return null
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
      startedAt: room.startedAt,
      endedAt: room.endedAt,
      moveCount: room.moveCount,
      updatedAt: room.updatedAt,
    }
  }
}
