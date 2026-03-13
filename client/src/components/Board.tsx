import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Cube, PieceMap, PlayerId } from '../rules/types'
import { cubeToAxial, posKey } from '../rules/board'

export type RecentMoveAnimation = {
  id: string
  from: string
  to: string
  player: PlayerId
  isJump: boolean
  path: string[]
  segmentDurationMs: number
  segmentPauseMs: number
}

type BoardCell = {
  key: string
  x: number
  y: number
}

type BoardProps = {
  positions: Cube[]
  pieces: PieceMap
  selected: string | null
  validMoves: Set<string>
  homeCells?: Set<string>
  highlightHome?: boolean
  orientation?: 'normal' | 'flipped'
  recentMove?: RecentMoveAnimation | null
  onCellClick: (key: string) => void
}

const CELL_SIZE = 22
const PADDING = 34
const LANDING_SETTLE_MS = 90

type OverlayWaypoint = {
  key: string
  x: number
  y: number
}

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3
const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress

const AnimatedMoveOverlay = ({
  recentMove,
  points,
}: {
  recentMove: RecentMoveAnimation
  points: OverlayWaypoint[]
}) => {
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useEffect(() => {
    if (points.length < 2) {
      setStyle(null)
      return
    }

    const totalSegments = points.length - 1
    const totalDuration =
      totalSegments * recentMove.segmentDurationMs +
      (totalSegments - 1) * recentMove.segmentPauseMs +
      LANDING_SETTLE_MS
    const startedAt = performance.now()
    let frameId = 0

    const render = (now: number) => {
      const elapsed = Math.min(now - startedAt, totalDuration)
      const segmentWindow = recentMove.segmentDurationMs + recentMove.segmentPauseMs
      const rawSegmentIndex = Math.min(
        Math.floor(elapsed / segmentWindow),
        totalSegments - 1,
      )
      const segmentElapsed = elapsed - rawSegmentIndex * segmentWindow
      const segmentProgress = Math.min(segmentElapsed / recentMove.segmentDurationMs, 1)
      const localProgress = easeOutCubic(segmentProgress)
      const fromPoint = points[rawSegmentIndex]
      const toPoint = points[rawSegmentIndex + 1]
      const isResting = segmentElapsed > recentMove.segmentDurationMs
      const restElapsed = Math.max(segmentElapsed - recentMove.segmentDurationMs, 0)
      const restProgress = Math.min(restElapsed / Math.max(recentMove.segmentPauseMs, 1), 1)
      const hopHeight = recentMove.isJump ? 22 : 12
      const arcLift = Math.sin(segmentProgress * Math.PI) * hopHeight
      const baseX = isResting ? toPoint.x : lerp(fromPoint.x, toPoint.x, localProgress)
      const baseY = isResting ? toPoint.y : lerp(fromPoint.y, toPoint.y, localProgress) - arcLift
      const stretch = isResting
        ? 1 + Math.sin((1 - restProgress) * Math.PI) * 0.08
        : 1 + Math.sin(segmentProgress * Math.PI) * 0.06
      const squash = isResting
        ? 1 - Math.sin((1 - restProgress) * Math.PI) * 0.1
        : 1 - Math.sin(segmentProgress * Math.PI) * 0.04
      const shadow = isResting ? 1 : 0.82 + segmentProgress * 0.18

      setStyle({
        left: baseX,
        top: baseY,
        '--piece-scale-x': `${stretch}`,
        '--piece-scale-y': `${squash}`,
        '--piece-shadow-strength': `${shadow}`,
      } as CSSProperties)

      if (elapsed < totalDuration) {
        frameId = window.requestAnimationFrame(render)
      }
    }

    frameId = window.requestAnimationFrame(render)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [points, recentMove])

  if (!style) {
    return null
  }

  return (
    <div
      className={`move-overlay ${recentMove.player === 'A' ? 'player-a' : 'player-b'} ${recentMove.isJump ? 'jump' : 'step'}`}
      style={style}
      aria-hidden="true"
    >
      <span className="cell-dot" />
    </div>
  )
}

const Board = ({
  positions,
  pieces,
  selected,
  validMoves,
  homeCells,
  highlightHome = false,
  orientation = 'normal',
  recentMove,
  onCellClick,
}: BoardProps) => {
  const layout = useMemo(() => {
    const cells: BoardCell[] = positions.map((pos) => {
      const axial = cubeToAxial(pos)
      const x = CELL_SIZE * Math.sqrt(3) * (axial.q + axial.r / 2)
      const y = CELL_SIZE * 1.5 * axial.r
      return {
        key: posKey(pos),
        x,
        y,
      }
    })

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    cells.forEach((cell) => {
      minX = Math.min(minX, cell.x)
      maxX = Math.max(maxX, cell.x)
      minY = Math.min(minY, cell.y)
      maxY = Math.max(maxY, cell.y)
    })

    const width = maxX - minX + PADDING * 2
    const height = maxY - minY + PADDING * 2

    return {
      cells,
      cellMap: new Map(cells.map((cell) => [cell.key, cell])),
      minX,
      minY,
      width,
      height,
    }
  }, [positions])

  const movePoints = useMemo(() => {
    if (!recentMove) {
      return []
    }

    return recentMove.path.flatMap((key) => {
      const cell = layout.cellMap.get(key)
      if (!cell) {
        return []
      }

      return [
        {
          key,
          x: cell.x - layout.minX + PADDING,
          y: cell.y - layout.minY + PADDING,
        },
      ]
    })
  }, [layout.cellMap, layout.minX, layout.minY, recentMove])

  return (
    <div
      className={`board ${orientation === 'flipped' ? 'flipped' : ''}`}
      style={{ width: layout.width, height: layout.height }}
    >
      {layout.cells.map((cell) => {
        if (!homeCells?.has(cell.key)) {
          return null
        }
        return (
          <div
            key={`home-${cell.key}`}
            className={`home-outline ${highlightHome ? 'pulse' : ''}`}
            style={{
              left: cell.x - layout.minX + PADDING,
              top: cell.y - layout.minY + PADDING,
            }}
          />
        )
      })}
      {layout.cells.map((cell) => {
        const owner = pieces[cell.key]
        const isSelected = selected === cell.key
        const isMove = validMoves.has(cell.key)
        const isAnimatingTarget = recentMove?.to === cell.key && recentMove.player === owner
        const className = [
          'cell',
          owner ? 'occupied' : '',
          owner === 'A' ? 'player-a' : '',
          owner === 'B' ? 'player-b' : '',
          isSelected ? 'selected' : '',
          isMove ? 'move' : '',
          isAnimatingTarget ? 'arriving' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={cell.key}
            className={className}
            style={{
              left: cell.x - layout.minX + PADDING,
              top: cell.y - layout.minY + PADDING,
            }}
            onClick={() => onCellClick(cell.key)}
            type="button"
          >
            <span className="cell-dot" />
          </button>
        )
      })}
      {recentMove && movePoints.length > 1 && (
        <AnimatedMoveOverlay key={recentMove.id} recentMove={recentMove} points={movePoints} />
      )}
    </div>
  )
}

export default Board
