import type { PieceMap, PlayerId } from './types.js'

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export type PlayerSlot = {
  id: string
  connected: boolean
  ready: boolean
}

export type RoomState = {
  roomId: string
  status: RoomStatus
  players: Record<PlayerId, PlayerSlot | null>
  currentPlayer: PlayerId
  pieces: PieceMap
  winner: PlayerId | null
  startedAt: number | null
  endedAt: number | null
  moveCount: number
  updatedAt: number
}

export type MoveIntent = {
  roomId: string
  from: string
  to: string
}

export type RoomJoinPayload = {
  roomId: string
}

export type RoomReconnectPayload = {
  roomId: string
  token: string
}

export type RoomReadyPayload = {
  roomId: string
  ready: boolean
  token: string
}

export type RoomJoinedPayload = {
  roomId: string
  seat: PlayerId
  token: string
}

export type RoomErrorPayload = {
  message: string
}

export type EmojiPayload = {
  roomId: string
  emoji: string
  from: PlayerId
  at: number
}

export type ChatPayload = {
  roomId: string
  message: string
  from: PlayerId
  at: number
}

export type RestartPayload = {
  roomId: string
  token: string
}

export type LeaveRoomPayload = {
  roomId: string
  token: string
}

export type EmojiSendPayload = {
  roomId: string
  emoji: string
  token: string
}

export type ChatSendPayload = {
  roomId: string
  message: string
  token: string
}

export type ServerEventMap = {
  'room:state': RoomState
  'room:error': RoomErrorPayload
  'emoji:receive': EmojiPayload
  'chat:receive': ChatPayload
}

export type ClientEventMap = {
  'room:create': undefined
  'room:join': RoomJoinPayload
  'room:reconnect': RoomReconnectPayload
  'room:ready': RoomReadyPayload
  'room:leave': LeaveRoomPayload
  'move:intent': MoveIntent & { token: string }
  'emoji:send': EmojiSendPayload
  'room:restart': RestartPayload
  'chat:send': ChatSendPayload
}

type EventEnvelope<TType extends string, TPayload> = TPayload extends undefined
  ? { type: TType }
  : { type: TType; payload: TPayload }

export type ServerEvent = {
  [Type in keyof ServerEventMap]: EventEnvelope<Type, ServerEventMap[Type]>
}[keyof ServerEventMap]

export type ClientEvent = {
  [Type in keyof ClientEventMap]: EventEnvelope<Type, ClientEventMap[Type]>
}[keyof ClientEventMap]

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void
  'room:error': (payload: RoomErrorPayload) => void
  'emoji:receive': (payload: EmojiPayload) => void
  'chat:receive': (payload: ChatPayload) => void
}

export interface ClientToServerEvents {
  'room:create': () => void
  'room:join': (payload: RoomJoinPayload) => void
  'room:reconnect': (payload: { roomId: string; token: string }) => void
  'room:ready': (payload: { roomId: string; ready: boolean }) => void
  'room:leave': (payload: RoomJoinPayload) => void
  'move:intent': (payload: MoveIntent) => void
  'emoji:send': (payload: { roomId: string; emoji: string }) => void
  'room:restart': (payload: { roomId: string }) => void
  'chat:send': (payload: { roomId: string; message: string }) => void
}
