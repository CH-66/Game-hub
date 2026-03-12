import { useEffect, useMemo, useState } from 'react'
import Board from './components/Board'
import { createBoard, createInitialPieces } from './rules/board'
import type { PieceMap, PlayerId } from './rules/types'
import { getValidMoves } from './rules/move'
import { getWinner } from './rules/win'
import { useGameSocket } from './net/useGameSocket'
import './App.css'

const BOARD_SIZE = 4
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000'
const EMOJI_LIST = ['🎉', '🔥', '😎', '👏', '😅', '👀']

function App() {
  const board = useMemo(() => createBoard(BOARD_SIZE), [])
  const [mode, setMode] = useState<'local' | 'online'>('local')
  const [roomInput, setRoomInput] = useState('')
  const [pieces, setPieces] = useState<PieceMap>(() => createInitialPieces(board))
  const [currentPlayer, setCurrentPlayer] = useState<PlayerId>('A')
  const [selected, setSelected] = useState<string | null>(null)
  const [validMoves, setValidMoves] = useState<Set<string>>(new Set())
  const [winner, setWinner] = useState<PlayerId | null>(null)
  const [reconnectAttempted, setReconnectAttempted] = useState(false)

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
  }, [mode, roomState?.updatedAt])

  useEffect(() => {
    if (mode !== 'online') {
      setReconnectAttempted(false)
      return
    }
    if (!hasSession || roomState || reconnectAttempted) {
      return
    }
    reconnect()
    setReconnectAttempted(true)
  }, [mode, hasSession, roomState, reconnectAttempted, reconnect])

  const resetGame = () => {
    setPieces(createInitialPieces(board))
    setCurrentPlayer('A')
    setSelected(null)
    setValidMoves(new Set())
    setWinner(null)
  }

  const handleCellClick = (key: string) => {
    if (mode === 'local') {
      if (winner) {
        return
      }

      const owner = pieces[key]
      if (owner === currentPlayer) {
        setSelected(key)
        const moves = getValidMoves(key, pieces, board.positionSet)
        setValidMoves(new Set([...moves.steps, ...moves.jumps]))
        return
      }

      if (selected && validMoves.has(key)) {
        const mover = pieces[selected]
        if (!mover) {
          return
        }
        const nextPieces = { ...pieces }
        delete nextPieces[selected]
        nextPieces[key] = mover
        setPieces(nextPieces)
        setSelected(null)
        setValidMoves(new Set())
        const winnerNow = getWinner(nextPieces, board.homeA, board.homeB)
        if (winnerNow) {
          setWinner(winnerNow)
          return
        }
        setCurrentPlayer(mover === 'A' ? 'B' : 'A')
        return
      }

      setSelected(null)
      setValidMoves(new Set())
      return
    }

    if (!roomState || !seat) {
      return
    }

    const canAct =
      roomState.status === 'playing' && roomState.currentPlayer === seat && !roomState.winner
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

  const activePieces = mode === 'local' ? pieces : roomState?.pieces ?? {}
  const isOnlineTurn =
    mode === 'online' &&
    roomState &&
    seat &&
    roomState.status === 'playing' &&
    roomState.currentPlayer === seat &&
    !roomState.winner
  const localHighlightHome = mode === 'local' && !winner
  const highlightHome = mode === 'online' ? isOnlineTurn : localHighlightHome
  const homeCells =
    mode === 'online'
      ? seat === 'A'
        ? board.homeA
        : board.homeB
      : currentPlayer === 'A'
        ? board.homeA
        : board.homeB
  const orientation = mode === 'online' && seat === 'B' ? 'flipped' : 'normal'
  const roomReady = seat ? roomState?.players[seat]?.ready : false

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
          <p className="subtitle">支持本地对战与在线房间，后续可扩展 4/6 人。</p>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-btn ${mode === 'local' ? 'active' : ''}`}
              onClick={() => setMode('local')}
            >
              本地
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'online' ? 'active' : ''}`}
              onClick={() => setMode('online')}
            >
              在线
            </button>
          </div>
        </div>
        <div className="status-card">
          {mode === 'local' ? (
            <>
              <p className="status-label">当前回合</p>
              <p
                className={`status-player ${currentPlayer === 'A' ? 'player-a' : 'player-b'}`}
              >
                {currentPlayer === 'A' ? '红方' : '蓝方'}
              </p>
              {winner && (
                <p className={`status-win ${winner === 'A' ? 'player-a' : 'player-b'}`}>
                  胜者：{winner === 'A' ? '红方' : '蓝方'}
                </p>
              )}
              <button type="button" className="reset-btn" onClick={resetGame}>
                重置对局
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>

      {mode === 'online' && !roomState ? (
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
          {mode === 'online' && roomState && (
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
            {mode === 'online' && roomState ? (
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
            ) : (
              <div className="legend-row">点击棋子查看可走位置，点击目标完成移动。</div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
