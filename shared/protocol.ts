import type { PieceMap, PlayerId } from './types'

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

export type RoomReadyPayload = {
  roomId: string
  ready: boolean
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

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void
  'room:joined': (payload: RoomJoinedPayload) => void
  'room:error': (payload: RoomErrorPayload) => void
  'emoji:receive': (payload: EmojiPayload) => void
  'chat:receive': (payload: ChatPayload) => void
}

export interface ClientToServerEvents {
  'room:create': () => void
  'room:join': (payload: RoomJoinPayload) => void
  'room:reconnect': (payload: { roomId: string; token: string }) => void
  'room:ready': (payload: RoomReadyPayload) => void
  'room:leave': (payload: RoomJoinPayload) => void
  'move:intent': (payload: MoveIntent) => void
  'emoji:send': (payload: { roomId: string; emoji: string }) => void
  'room:restart': (payload: { roomId: string }) => void
  'chat:send': (payload: { roomId: string; message: string }) => void
}
