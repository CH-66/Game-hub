import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './components/Board'
import { createBoard } from './rules/board'
import type { PlayerId } from './rules/types'
import { getValidMoves } from './rules/move'
import { useGameSocket } from './net/useGameSocket'
import './App.css'

const BOARD_SIZE = 4
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000'
const EMOJI_LIST = ['🎉', '🔥', '😎', '👏', '😅', '👀']

function App() {
  const board = useMemo(() => createBoard(BOARD_SIZE), [])
  const [roomInput, setRoomInput] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [validMoves, setValidMoves] = useState<Set<string>>(new Set())
  const [reconnectAttempted, setReconnectAttempted] = useState(false)
  const [showTurnToast, setShowTurnToast] = useState(false)
  const prevIsOnlineTurnRef = useRef(false)

  const {
    roomState,
    seat,
    error,
    connected,
    hasSession,
    emojiFeed,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    sendMove,
    sendEmoji,
    reconnect,
  } = useGameSocket(SERVER_URL)

  useEffect(() => {
    setSelected(null)
    setValidMoves(new Set())
  }, [roomState?.updatedAt])

  useEffect(() => {
    if (!hasSession || roomState || reconnectAttempted) {
      return
    }
    reconnect()
    setReconnectAttempted(true)
  }, [hasSession, roomState, reconnectAttempted, reconnect])

  const handleCellClick = (key: string) => {
    if (!roomState || !seat) {
      return
    }

    const opponentSeat = seat === 'A' ? 'B' : 'A'
    const opponentConnected = roomState.players[opponentSeat]?.connected ?? false
    const canAct =
      roomState.status === 'playing' &&
      roomState.currentPlayer === seat &&
      !roomState.winner &&
      opponentConnected
    const owner = roomState.pieces[key]

    if (owner === seat && canAct) {
      setSelected(key)
      const moves = getValidMoves(key, roomState.pieces, board.positionSet)
      setValidMoves(new Set([...moves.steps, ...moves.jumps]))
      return
    }

    if (selected && validMoves.has(key) && canAct) {
      sendMove(roomState.roomId, selected, key)
      setSelected(null)
      setValidMoves(new Set())
      return
    }

    setSelected(null)
    setValidMoves(new Set())
  }

  const activePieces = roomState?.pieces ?? {}
  const opponentSeat = seat === 'A' ? 'B' : 'A'
  const opponentConnected = seat ? roomState?.players[opponentSeat]?.connected ?? false : false
  const isOnlineTurn =
    roomState &&
    seat &&
    roomState.status === 'playing' &&
    roomState.currentPlayer === seat &&
    !roomState.winner &&
    opponentConnected
  const highlightHome = Boolean(isOnlineTurn)
  const homeCells = seat === 'B' ? board.homeB : board.homeA
  const orientation = seat === 'A' ? 'flipped' : 'normal'
  const waitingForOpponent =
    roomState && seat && !roomState.winner && roomState.status === 'playing' && !opponentConnected
  const roomReady = seat ? roomState?.players[seat]?.ready : false

  useEffect(() => {
    const prev = prevIsOnlineTurnRef.current
    if (isOnlineTurn && !prev) {
      setShowTurnToast(true)
      const timer = window.setTimeout(() => {
        setShowTurnToast(false)
      }, 1200)
      return () => window.clearTimeout(timer)
    }
    prevIsOnlineTurnRef.current = isOnlineTurn
    return undefined
  }, [isOnlineTurn])

  const handleJoin = () => {
    const value = roomInput.trim().toUpperCase()
    if (!value) {
      return
    }
    joinRoom(value)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Chinese Checkers Online</p>
          <h1>跳跳棋 · 在线对战原型</h1>
          <p className="subtitle">仅在线房间对战，后续可扩展 4/6 人。</p>
        </div>
        <div className="header-side">
          <div className="status-card">
            <p className="status-label">连接状态</p>
            <p className="status-player">{connected ? '已连接' : '未连接'}</p>
            {roomState && (
              <>
                <p className="status-label">房间号</p>
                <p className="status-player">{roomState.roomId}</p>
                <p className="status-label">你的座位</p>
                <p className={`status-player ${seat === 'A' ? 'player-a' : 'player-b'}`}>
                  {seat === 'A' ? '红方' : '蓝方'}
                </p>
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => setReady(roomState.roomId, !roomReady)}
                >
                  {roomReady ? '取消准备' : '准备'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => leaveRoom(roomState.roomId)}
                >
                  离开房间
                </button>
              </>
            )}
          </div>
          {roomState && (
            <section className="room-status">
              <div className="room-status-main">
                <div>
                  <p className="status-label">房间状态</p>
                  <p className="status-player">
                    {roomState.status === 'playing' ? '对局中' : '等待中'}
                    {roomState.winner
                      ? ` · 胜者 ${roomState.winner === 'A' ? '红方' : '蓝方'}`
                      : ''}
                  </p>
                  <p className="room-id">房间号：{roomState.roomId}</p>
                </div>
                <div className="turn-pill">
                  当前回合：
                  {roomState.currentPlayer === 'A' ? '红方' : '蓝方'}
                </div>
              </div>
              <div className="ready-list">
                {(['A', 'B'] as const).map((side) => {
                  const slot = roomState.players[side]
                  const name = side === 'A' ? '红方' : '蓝方'
                  return (
                    <div key={side} className="ready-item">
                      <span className={`ready-name ${side === 'A' ? 'player-a' : 'player-b'}`}>
                        {name}
                      </span>
                      <span className={slot?.connected ? 'tag' : 'tag warn'}>
                        {slot?.connected ? '在线' : '离线'}
                      </span>
                      <span className={slot?.ready ? 'tag ok' : 'tag'}>
                        {slot?.ready ? '已准备' : '未准备'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </header>

      {!roomState ? (
        <section className="lobby">
          <div className="lobby-card">
            <h2>创建或加入房间</h2>
            <p>创建房间后分享房间号给好友。</p>
            <button type="button" className="reset-btn" onClick={createRoom}>
              创建房间
            </button>
            {hasSession && (
              <button type="button" className="ghost-btn" onClick={reconnect}>
                恢复上次对局
              </button>
            )}
            <div className="lobby-row">
              <input
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                placeholder="输入房间号"
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={handleJoin}
                disabled={!roomInput.trim()}
              >
                加入
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </section>
      ) : (
        <main className="app-main">
          {waitingForOpponent && (
            <div className="toast-mask" role="alert" aria-live="polite">
              <div className="toast-card">
                <p className="toast-title">对手已掉线</p>
                <p className="toast-body">等待重连…</p>
              </div>
            </div>
          )}
          {showTurnToast && (
            <div className="toast-float" role="status" aria-live="polite">
              <div className="toast-card toast-card--small">
                <p className="toast-title">轮到你了</p>
              </div>
            </div>
          )}
          <Board
            positions={board.positions}
            pieces={activePieces}
            selected={selected}
            validMoves={validMoves}
            homeCells={homeCells}
            highlightHome={highlightHome}
            orientation={orientation}
            onCellClick={handleCellClick}
          />
          <section className="legend">
            <div className="legend-row">
              <span className="legend-dot player-a" />
              红方起点
            </div>
            <div className="legend-row">
              <span className="legend-dot player-b" />
              蓝方起点
            </div>
            <div className="legend-row">点击棋子查看可走位置，点击目标完成移动。</div>
            <div className="emoji-panel">
              <div className="emoji-list">
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-btn"
                    onClick={() => sendEmoji(roomState.roomId, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="emoji-feed">
                {emojiFeed.length === 0 ? (
                  <span className="emoji-empty">还没有表情</span>
                ) : (
                  emojiFeed.map((item) => (
                    <div key={`${item.at}-${item.emoji}`} className="emoji-item">
                      <span
                        className={`emoji-from ${item.from === 'A' ? 'player-a' : 'player-b'}`}
                      >
                        {item.from === 'A' ? '红方' : '蓝方'}
                      </span>
                      <span className="emoji-icon">{item.emoji}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
