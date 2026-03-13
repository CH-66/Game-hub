import { DurableObject } from 'cloudflare:workers'
import type {
  ChatPayload,
  ChatSendPayload,
  EmojiPayload,
  EmojiSendPayload,
  MoveIntent,
  RoomJoinedPayload,
  RoomReadyPayload,
  RoomState,
  RoomStatus,
} from '../../shared/protocol.js'
import type { PieceMap, PlayerId } from '../../shared/types.js'
import { EMOJI_LIST } from '../../shared/emojis.js'
import { createBoard, createInitialPieces } from '../../server/src/rules/board.js'
import { getValidMoves } from '../../server/src/rules/move.js'
import { getWinner } from '../../server/src/rules/win.js'

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

type SocketAttachment = {
  seat: PlayerId
  token: string
}

type JsonObject = Record<string, unknown>

const ROOM_STATE_KEY = 'room'
const BOARD_SIZE = 4
const DISCONNECT_TIMEOUT_MS = 10 * 60 * 1000
const EMPTY_ROOM_GRACE_MS = 30 * 1000
const MAX_CHAT_LENGTH = 120
const EMOJI_COOLDOWN_MS = 1200
const CHAT_COOLDOWN_MS = 900
const ROOM_ID_PATTERN = /^[A-Z0-9]{6}$/
const board = createBoard(BOARD_SIZE)

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message)
  }
}

const json = (payload: unknown, init?: ResponseInit): Response =>
  Response.json(payload, init)

const readJson = async (request: Request): Promise<JsonObject> => {
  const payload = await request.json().catch(() => null)
  if (!isObject(payload)) {
    throw new Error('Invalid JSON payload.')
  }
  return payload
}

const hasRoomId = (payload: JsonObject): payload is { roomId: string } => isString(payload.roomId)

const hasToken = (payload: JsonObject): payload is { token: string } => isString(payload.token)

const isRoomReadyPayload = (payload: JsonObject): payload is RoomReadyPayload =>
  hasRoomId(payload) && hasToken(payload) && isBoolean(payload.ready)

const isMoveIntentPayload = (payload: JsonObject): payload is MoveIntent & { token: string } =>
  hasRoomId(payload) && hasToken(payload) && isString(payload.from) && isString(payload.to)

const isEmojiSendPayload = (payload: JsonObject): payload is EmojiSendPayload =>
  hasRoomId(payload) && hasToken(payload) && isString(payload.emoji)

const isChatSendPayload = (payload: JsonObject): payload is ChatSendPayload =>
  hasRoomId(payload) && hasToken(payload) && isString(payload.message)

export class GameRoom extends DurableObject {
  private room: Room | null = null

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)

    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get<Room>(ROOM_STATE_KEY)
      if (this.room) {
        await this.restoreConnectionFlags()
        await this.scheduleDisconnectAlarm()
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    try {
      if (request.method === 'POST' && url.pathname === '/create') {
        return await this.handleCreate(request)
      }

      if (request.method === 'POST' && url.pathname === '/join') {
        return await this.handleJoin(request)
      }

      if (request.method === 'POST' && url.pathname === '/reconnect') {
        return await this.handleReconnect(request)
      }

      if (request.method === 'POST' && url.pathname === '/ready') {
        return await this.handleReady(request)
      }

      if (request.method === 'POST' && url.pathname === '/move') {
        return await this.handleMove(request)
      }

      if (request.method === 'POST' && url.pathname === '/emoji') {
        return await this.handleEmoji(request)
      }

      if (request.method === 'POST' && url.pathname === '/chat') {
        return await this.handleChat(request)
      }

      if (request.method === 'POST' && url.pathname === '/restart') {
        return await this.handleRestart(request)
      }

      if (request.method === 'POST' && url.pathname === '/leave') {
        return await this.handleLeave(request)
      }

      if (request.method === 'GET' && url.pathname === '/state') {
        return this.handleState()
      }

      if (
        request.method === 'GET' &&
        (url.pathname === '/websocket' || url.pathname.startsWith('/ws/'))
      ) {
        return this.handleWebSocket(request)
      }

      return new Response('Not found.', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected room error.'
      return json({ message }, { status: 400 })
    }
  }

  async alarm(): Promise<void> {
    if (!this.room) {
      return
    }

    const now = Date.now()

    if (this.shouldReapIdleRoom(now)) {
      await this.destroyRoom()
      return
    }

    let changed = false

    ;(['A', 'B'] as const).forEach((seat) => {
      const slot = this.room?.players[seat]
      if (!slot || slot.connected || !slot.disconnectedAt || this.room?.winner) {
        return
      }
      if (now - slot.disconnectedAt > DISCONNECT_TIMEOUT_MS && this.room?.status === 'playing') {
        this.room.winner = seat === 'A' ? 'B' : 'A'
        this.room.status = 'finished'
        this.room.endedAt = now
        this.room.updatedAt = now
        changed = true
      }
    })

    if (changed) {
      await this.persistRoom()
      this.broadcastEvent('room:state', this.toRoomState())
    }

    await this.scheduleDisconnectAlarm()
  }

  async webSocketMessage(_ws: WebSocket, _message: ArrayBuffer | string): Promise<void> {}

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (!this.room) {
      return
    }

    const attachment = this.readAttachment(ws)
    if (!attachment) {
      return
    }

    const slot = this.room.players[attachment.seat]
    if (!slot || slot.token !== attachment.token) {
      return
    }

    const hasSiblingSocket = this.getSockets().some((socket) => {
      if (socket === ws) {
        return false
      }
      const meta = this.readAttachment(socket)
      return meta?.seat === attachment.seat && meta.token === attachment.token
    })

    if (hasSiblingSocket) {
      return
    }

    slot.connected = false
    slot.disconnectedAt = Date.now()
    this.room.updatedAt = Date.now()

    await this.persistRoom()
    await this.scheduleDisconnectAlarm()
    if (!this.hasNoConnectedPlayers()) {
      this.broadcastEvent('room:state', this.toRoomState())
    }
  }

  private async handleCreate(request: Request): Promise<Response> {
    assert(!this.room, 'Room already exists.')

    const roomId = request.headers.get('x-room-id') ?? ''
    assert(ROOM_ID_PATTERN.test(roomId), 'Missing room ID.')
    const token = crypto.randomUUID()

    this.room = {
      id: roomId,
      status: 'waiting',
      players: {
        A: { id: 'A', connected: false, ready: false, token },
        B: null,
      },
      pieces: createInitialPieces(board),
      currentPlayer: 'A',
      winner: null,
      startedAt: null,
      endedAt: null,
      moveCount: 0,
      updatedAt: Date.now(),
    }

    await this.persistRoom()

    const payload: RoomJoinedPayload = {
      roomId,
      seat: 'A',
      token,
    }

    return json(payload, { status: 201 })
  }

  private async handleJoin(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(hasRoomId(payload), 'roomId is required.')

    const room = this.requireRoom(payload.roomId)
    const seat = room.players.A ? (room.players.B ? null : 'B') : 'A'
    assert(seat, 'Room is full.')

    const token = crypto.randomUUID()
    room.players[seat] = {
      id: seat,
      connected: false,
      ready: false,
      token,
    }
    room.updatedAt = Date.now()

    await this.persistRoom()

    const joinedPayload: RoomJoinedPayload = {
      roomId: room.id,
      seat,
      token,
    }

    return json(joinedPayload)
  }

  private async handleReconnect(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(hasRoomId(payload) && hasToken(payload), 'roomId and token are required.')

    const room = this.requireRoom(payload.roomId)
    const seat = this.requireSeatByToken(room, payload.token)
    const joinedPayload: RoomJoinedPayload = {
      roomId: room.id,
      seat,
      token: payload.token,
    }

    return json(joinedPayload)
  }

  private async handleReady(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(isRoomReadyPayload(payload), 'Invalid ready payload.')

    const room = this.requireRoom(payload.roomId)
    const seat = this.requireSeatByToken(room, payload.token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    slot.ready = payload.ready
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

    await this.persistRoom()
    const state = this.toRoomState()
    this.broadcastEvent('room:state', state)
    return json(state)
  }

  private async handleMove(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(isMoveIntentPayload(payload), 'Invalid move payload.')

    const room = this.requireRoom(payload.roomId)
    this.assertRoomPlayable(room)
    const seat = this.requireSeatByToken(room, payload.token)
    assert(seat === room.currentPlayer, 'It is not your turn.')

    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    if (slot.lastMoveAt && Date.now() - slot.lastMoveAt < 200) {
      throw new Error('Too many move attempts.')
    }

    const owner = room.pieces[payload.from]
    assert(owner === seat, 'The selected piece does not belong to you.')

    const moves = getValidMoves(payload.from, room.pieces, board.positionSet)
    const isValid = moves.steps.has(payload.to) || moves.jumps.has(payload.to)
    assert(isValid, 'Illegal move.')

    const nextPieces: PieceMap = { ...room.pieces }
    delete nextPieces[payload.from]
    nextPieces[payload.to] = seat

    room.pieces = nextPieces
    room.updatedAt = Date.now()
    room.moveCount += 1
    slot.lastMoveAt = room.updatedAt
    room.winner = getWinner(nextPieces, board.homeA, board.homeB)

    if (room.winner) {
      room.status = 'finished'
      room.endedAt = Date.now()
    } else {
      room.currentPlayer = seat === 'A' ? 'B' : 'A'
    }

    await this.persistRoom()
    const state = this.toRoomState()
    this.broadcastEvent('room:state', state)
    return json(state)
  }

  private async handleEmoji(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(isEmojiSendPayload(payload), 'Invalid emoji payload.')

    const room = this.requireRoom(payload.roomId)
    const seat = this.requireSeatByToken(room, payload.token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')
    assert(EMOJI_LIST.includes(payload.emoji), 'Unsupported emoji.')

    const now = Date.now()
    if (slot.lastEmojiAt && now - slot.lastEmojiAt < EMOJI_COOLDOWN_MS) {
      throw new Error('Emoji cooldown is active.')
    }
    slot.lastEmojiAt = now

    const eventPayload: EmojiPayload = {
      roomId: room.id,
      emoji: payload.emoji,
      from: seat,
      at: now,
    }

    this.broadcastEvent('emoji:receive', eventPayload)
    return new Response(null, { status: 204 })
  }

  private async handleChat(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(isChatSendPayload(payload), 'Invalid chat payload.')

    const room = this.requireRoom(payload.roomId)
    const seat = this.requireSeatByToken(room, payload.token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    const message = payload.message.trim()
    assert(message.length > 0, 'Message cannot be empty.')
    assert(message.length <= MAX_CHAT_LENGTH, 'Message is too long.')

    const now = Date.now()
    if (slot.lastChatAt && now - slot.lastChatAt < CHAT_COOLDOWN_MS) {
      throw new Error('Chat cooldown is active.')
    }
    slot.lastChatAt = now

    const eventPayload: ChatPayload = {
      roomId: room.id,
      message,
      from: seat,
      at: now,
    }

    this.broadcastEvent('chat:receive', eventPayload)
    return new Response(null, { status: 204 })
  }

  private async handleRestart(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(hasRoomId(payload) && hasToken(payload), 'roomId and token are required.')

    const room = this.requireRoom(payload.roomId)
    this.requireSeatByToken(room, payload.token)

    room.status = 'waiting'
    room.pieces = createInitialPieces(board)
    room.currentPlayer = 'A'
    room.winner = null
    room.startedAt = null
    room.endedAt = null
    room.moveCount = 0
    room.updatedAt = Date.now()

    ;(['A', 'B'] as const).forEach((seat) => {
      const slot = room.players[seat]
      if (slot) {
        slot.ready = false
      }
    })

    await this.persistRoom()
    const state = this.toRoomState()
    this.broadcastEvent('room:state', state)
    return json(state)
  }

  private async handleLeave(request: Request): Promise<Response> {
    const payload = await readJson(request)
    assert(hasRoomId(payload) && hasToken(payload), 'roomId and token are required.')

    const room = this.requireRoom(payload.roomId)
    const seat = this.requireSeatByToken(room, payload.token)

    room.players[seat] = null
    room.updatedAt = Date.now()
    this.closeSeatSockets(seat, payload.token, 1000, 'Left room.')

    if (!room.players.A && !room.players.B) {
      await this.destroyRoom()
      return new Response(null, { status: 204 })
    }

    if (room.status === 'playing') {
      room.status = 'finished'
      room.winner = seat === 'A' ? 'B' : 'A'
      room.endedAt = Date.now()
    }

    await this.persistRoom()
    const state = this.toRoomState()
    this.broadcastEvent('room:state', state)
    return json(state)
  }

  private handleState(): Response {
    if (!this.room) {
      return json({ message: 'Room not found.' }, { status: 404 })
    }
    return json(this.toRoomState())
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade.', { status: 426 })
    }

    const room = this.requireRoom()
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    assert(token, 'token is required.')

    const seat = this.requireSeatByToken(room, token)
    const slot = room.players[seat]
    assert(slot, 'Player not found.')

    const socketsForSeat = this.getSockets().filter((socket) => {
      const attachment = this.readAttachment(socket)
      return attachment?.seat === seat && attachment.token === token
    })

    socketsForSeat.forEach((socket) => {
      socket.close(1000, 'Superseded by a newer connection.')
    })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    const attachment: SocketAttachment = { seat, token }

    server.serializeAttachment(attachment)
    this.ctx.acceptWebSocket(server)

    slot.connected = true
    slot.disconnectedAt = undefined
    room.updatedAt = Date.now()
    await this.persistRoom()
    await this.scheduleDisconnectAlarm()

    return new Response(null, { status: 101, webSocket: client })
  }

  private getSockets(): WebSocket[] {
    return this.ctx.getWebSockets()
  }

  private readAttachment(socket: WebSocket): SocketAttachment | null {
    const attachment = socket.deserializeAttachment()
    if (!isObject(attachment) || !isString(attachment.seat) || !isString(attachment.token)) {
      return null
    }
    if (attachment.seat !== 'A' && attachment.seat !== 'B') {
      return null
    }
    return {
      seat: attachment.seat,
      token: attachment.token,
    }
  }

  private closeSeatSockets(seat: PlayerId, token: string, code: number, reason: string): void {
    this.getSockets().forEach((socket) => {
      const attachment = this.readAttachment(socket)
      if (attachment?.seat === seat && attachment.token === token) {
        socket.close(code, reason)
      }
    })
  }

  private broadcastEvent<TType extends 'room:state' | 'emoji:receive' | 'chat:receive'>(
    type: TType,
    payload: TType extends 'room:state'
      ? RoomState
      : TType extends 'emoji:receive'
        ? EmojiPayload
        : ChatPayload,
  ): void {
    const encoded = JSON.stringify({ type, payload })
    this.getSockets().forEach((socket) => socket.send(encoded))
  }

  private requireRoom(expectedRoomId?: string): Room {
    assert(this.room, 'Room not found.')
    if (expectedRoomId) {
      assert(this.room.id === expectedRoomId, 'Room mismatch.')
    }
    return this.room
  }

  private requireSeatByToken(room: Room, token: string): PlayerId {
    const seat = room.players.A?.token === token ? 'A' : room.players.B?.token === token ? 'B' : null
    assert(seat, 'Invalid session token.')
    return seat
  }

  private assertRoomPlayable(room: Room): void {
    assert(room.status === 'playing', 'The match has not started yet.')
    assert(!room.winner, 'The match is already finished.')
  }

  private toRoomState(): RoomState {
    const room = this.requireRoom()

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

  private async persistRoom(): Promise<void> {
    if (!this.room) {
      return
    }
    await this.ctx.storage.put(ROOM_STATE_KEY, this.room)
  }

  private hasNoConnectedPlayers(): boolean {
    if (!this.room) {
      return true
    }

    return !(['A', 'B'] as const).some((seat) => this.room?.players[seat]?.connected)
  }

  private async destroyRoom(): Promise<void> {
    this.room = null
    this.getSockets().forEach((socket) => {
      try {
        socket.close(1001, 'Room closed to conserve resources.')
      } catch {
        // Ignore already-closed sockets during teardown.
      }
    })
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private async restoreConnectionFlags(): Promise<void> {
    if (!this.room) {
      return
    }

    let changed = false

    ;(['A', 'B'] as const).forEach((seat) => {
      const slot = this.room?.players[seat]
      if (!slot) {
        return
      }

      const connected = this.getSockets().some((socket) => {
        const attachment = this.readAttachment(socket)
        return attachment?.seat === seat && attachment.token === slot.token
      })

      if (slot.connected !== connected) {
        changed = true
        slot.connected = connected
        slot.disconnectedAt = connected ? undefined : slot.disconnectedAt ?? Date.now()
      }
    })

    if (changed) {
      this.room.updatedAt = Date.now()
      await this.persistRoom()
    }
  }

  private shouldReapIdleRoom(now = Date.now()): boolean {
    if (!this.room || !this.hasNoConnectedPlayers()) {
      return false
    }

    const lastDisconnectedAt = this.getLastDisconnectedAt()
    return lastDisconnectedAt !== null && now - lastDisconnectedAt >= EMPTY_ROOM_GRACE_MS
  }

  private async scheduleDisconnectAlarm(): Promise<void> {
    if (!this.room) {
      await this.ctx.storage.deleteAlarm()
      return
    }

    const alarms: number[] = []

    if (this.hasNoConnectedPlayers()) {
      const lastDisconnectedAt = this.getLastDisconnectedAt()
      if (lastDisconnectedAt !== null) {
        alarms.push(lastDisconnectedAt + EMPTY_ROOM_GRACE_MS)
      }
    }

    if (this.room.status === 'playing' && !this.room.winner) {
      ;(['A', 'B'] as const)
        .map((seat) => this.room?.players[seat]?.disconnectedAt)
        .filter((value): value is number => typeof value === 'number')
        .forEach((disconnectedAt) => {
          alarms.push(disconnectedAt + DISCONNECT_TIMEOUT_MS)
        })
    }

    if (alarms.length === 0) {
      await this.ctx.storage.deleteAlarm()
      return
    }

    await this.ctx.storage.setAlarm(Math.min(...alarms))
  }

  private getLastDisconnectedAt(): number | null {
    if (!this.room) {
      return null
    }

    const disconnectedAtList = (['A', 'B'] as const)
      .map((seat) => this.room?.players[seat]?.disconnectedAt)
      .filter((value): value is number => typeof value === 'number')

    if (disconnectedAtList.length === 0) {
      return null
    }

    return Math.max(...disconnectedAtList)
  }
}
