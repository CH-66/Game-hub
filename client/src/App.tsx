import { useEffect, useMemo, useRef, useState } from 'react'
import { EMOJI_LIST } from '@shared/emojis'
import type { RoomState } from '@shared/protocol'
import { useGameAudio } from './audio/useGameAudio'
import Board from './components/Board'
import type { RecentMoveAnimation } from './components/Board'
import { createBoard, keyToCube } from './rules/board'
import type { PieceMap, PlayerId } from './rules/types'
import { getValidMoves } from './rules/move'
import { useGameSocket } from './net/useGameSocket'
import './App.css'

const BOARD_SIZE = 4
const SERVER_URL = import.meta.env.VITE_SERVER_URL?.trim() || window.location.origin
const MOVE_ANIMATION_MS = 520

const detectRecentMove = (
  previousPieces: PieceMap,
  nextPieces: PieceMap,
): Omit<RecentMoveAnimation, 'id'> | null => {
  const removed = Object.keys(previousPieces).filter((key) => previousPieces[key] && !nextPieces[key])
  const added = Object.keys(nextPieces).filter((key) => nextPieces[key] && !previousPieces[key])

  if (removed.length !== 1 || added.length !== 1) {
    return null
  }

  const from = removed[0]
  const to = added[0]
  const player = previousPieces[from]
  if (!player || nextPieces[to] !== player) {
    return null
  }

  const fromCube = keyToCube(from)
  const toCube = keyToCube(to)
  const distance = Math.max(
    Math.abs(fromCube.x - toCube.x),
    Math.abs(fromCube.y - toCube.y),
    Math.abs(fromCube.z - toCube.z),
  )

  return {
    from,
    to,
    player,
    isJump: distance > 1,
  }
}

function App() {
  const board = useMemo(() => createBoard(BOARD_SIZE), [])
  const [roomInput, setRoomInput] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [validMoves, setValidMoves] = useState<Set<string>>(new Set())
  const [reconnectAttempted, setReconnectAttempted] = useState(false)
  const [showTurnToast, setShowTurnToast] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [recentMove, setRecentMove] = useState<RecentMoveAnimation | null>(null)
  const [barrageItems, setBarrageItems] = useState<
    Array<{ id: string; emoji: string; from: PlayerId }>
  >([])
  const prevIsOnlineTurnRef = useRef(false)
  const prevRoomStateRef = useRef<RoomState | null>(null)
  const prevWinnerRef = useRef<PlayerId | null>(null)
  const lastEmojiAtRef = useRef<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const { soundEnabled, unlockAudio, playSound, toggleSound } = useGameAudio()

  const {
    roomState,
    seat,
    error,
    connected,
    hasSession,
    emojiFeed,
    chatFeed,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    sendMove,
    sendEmoji,
    sendChat,
    restartRoom,
    reconnect,
  } = useGameSocket(SERVER_URL)

  useEffect(() => {
    setSelected(null)
    setValidMoves(new Set())
  }, [roomState?.updatedAt])

  useEffect(() => {
    if (!roomState) {
      prevRoomStateRef.current = null
      setRecentMove(null)
      return
    }

    const previousState = prevRoomStateRef.current
    if (
      previousState &&
      previousState.roomId === roomState.roomId &&
      roomState.moveCount === previousState.moveCount + 1
    ) {
      const move = detectRecentMove(previousState.pieces, roomState.pieces)
      setRecentMove(
        move
          ? {
              ...move,
              id: `${roomState.updatedAt}-${move.from}-${move.to}`,
            }
          : null,
      )
    } else if (!previousState || previousState.roomId !== roomState.roomId) {
      setRecentMove(null)
    }

    prevRoomStateRef.current = roomState
  }, [roomState])

  useEffect(() => {
    if (!recentMove) {
      return
    }

    playSound(recentMove.isJump ? 'jump' : 'move')
    const timer = window.setTimeout(() => {
      setRecentMove((current) => (current?.id === recentMove.id ? null : current))
    }, MOVE_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [playSound, recentMove])

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
      playSound('select')
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
  const isOnlineTurn = Boolean(
    roomState &&
      seat &&
      roomState.status === 'playing' &&
      roomState.currentPlayer === seat &&
      !roomState.winner &&
      opponentConnected,
  )
  const highlightHome = Boolean(isOnlineTurn)
  const homeCells = seat === 'B' ? board.homeB : board.homeA
  const orientation = seat === 'A' ? 'flipped' : 'normal'
  const waitingForOpponent =
    roomState && seat && !roomState.winner && roomState.status === 'playing' && !opponentConnected
  const roomReady = seat ? roomState?.players[seat]?.ready : false
  const showWinnerToast = Boolean(roomState?.winner)

  const winnerLabel = roomState?.winner === 'A' ? '红方' : '蓝方'
  const durationMs =
    roomState?.startedAt && roomState?.endedAt
      ? Math.max(roomState.endedAt - roomState.startedAt, 0)
      : null
  const durationText =
    durationMs !== null
      ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
      : '—'

  useEffect(() => {
    const previousTurn = prevIsOnlineTurnRef.current
    if (isOnlineTurn && !previousTurn) {
      playSound('turn')
      setShowTurnToast(true)
      const timer = window.setTimeout(() => {
        setShowTurnToast(false)
      }, 1200)
      prevIsOnlineTurnRef.current = isOnlineTurn
      return () => window.clearTimeout(timer)
    }
    prevIsOnlineTurnRef.current = isOnlineTurn
    return undefined
  }, [isOnlineTurn, playSound])

  useEffect(() => {
    if (emojiFeed.length === 0) {
      return
    }

    const latest = emojiFeed[0]
    if (lastEmojiAtRef.current === latest.at) {
      return
    }

    playSound('emoji')
    lastEmojiAtRef.current = latest.at
    const id = `${latest.at}-${latest.from}`
    setBarrageItems((previous) => [...previous, { id, emoji: latest.emoji, from: latest.from }])
    const timer = window.setTimeout(() => {
      setBarrageItems((previous) => previous.filter((item) => item.id !== id))
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [emojiFeed, playSound])

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [chatFeed])

  useEffect(() => {
    if (!roomState?.winner) {
      prevWinnerRef.current = roomState?.winner ?? null
      return
    }

    if (prevWinnerRef.current !== roomState.winner) {
      playSound('win')
    }
    prevWinnerRef.current = roomState.winner
  }, [playSound, roomState?.winner])

  const handleJoin = () => {
    const value = roomInput.trim().toUpperCase()
    if (!value) {
      return
    }
    joinRoom(value)
  }

  const handleSendChat = () => {
    if (!roomState) {
      return
    }
    const text = chatInput.trim()
    if (!text) {
      return
    }
    sendChat(roomState.roomId, text)
    setChatInput('')
  }

  return (
    <div className="app" onPointerDown={unlockAudio} onKeyDownCapture={unlockAudio}>
      <header className="app-header">
        <div>
          <p className="eyebrow">Game-hub</p>
          <h1>跳跳棋 · 在线对战</h1>
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
                <button type="button" className="ghost-btn" onClick={toggleSound}>
                  {soundEnabled ? '音效已开' : '音效已关'}
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
              {roomState.winner && (
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => restartRoom(roomState.roomId)}
                >
                  开始新一轮
                </button>
              )}
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
          {showWinnerToast && roomState && (
            <div className="winner-toast" role="status" aria-live="polite">
              <div className="winner-badge">胜者：{winnerLabel}</div>
              <div className="winner-detail">房间号：{roomState.roomId}</div>
              <div className="winner-detail">总步数：{roomState.moveCount}</div>
              <div className="winner-detail">对局时长：{durationText}</div>
            </div>
          )}
          <div className="board-wrap">
            {barrageItems.length > 0 && (
              <div className="barrage-layer" aria-live="polite">
                {barrageItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`barrage-fly ${item.from === 'A' ? 'player-a' : 'player-b'}`}
                    style={{ top: `calc(50% + ${(index % 3) * 30 - 30}px)` }}
                  >
                    <span className="barrage-name">{item.from === 'A' ? '红方' : '蓝方'}</span>
                    <span className="barrage-emoji">{item.emoji}</span>
                  </div>
                ))}
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
              recentMove={recentMove}
              onCellClick={handleCellClick}
            />
          </div>
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
            <div className="legend-row">最近一步会有跳动轨迹，音效可在右侧面板开关。</div>
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
            </div>
          </section>
          <section className="chat-panel">
            <div className="chat-header">房间消息</div>
            <div className="chat-body">
              {chatFeed.length === 0 ? (
                <div className="chat-empty">暂无消息</div>
              ) : (
                chatFeed.map((item) => (
                  <div key={`${item.at}-${item.from}`} className="chat-row">
                    <span className={`chat-name ${item.from === 'A' ? 'player-a' : 'player-b'}`}>
                      {item.from === 'A' ? '红方' : '蓝方'}
                    </span>
                    <span className="chat-text">{item.message}</span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input">
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="发送一条消息…"
                maxLength={120}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSendChat()
                  }
                }}
              />
              <button type="button" className="ghost-btn" onClick={handleSendChat}>
                发送
              </button>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
