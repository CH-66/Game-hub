import { useMemo } from 'react'
import type { Cube, PieceMap } from '../rules/types'
import { cubeToAxial, posKey } from '../rules/board'

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
  onCellClick: (key: string) => void
}

const CELL_SIZE = 22
const PADDING = 34

const Board = ({
  positions,
  pieces,
  selected,
  validMoves,
  homeCells,
  highlightHome = false,
  orientation = 'normal',
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
      minX,
      minY,
      width,
      height,
    }
  }, [positions])

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
        const className = [
          'cell',
          owner ? 'occupied' : '',
          owner === 'A' ? 'player-a' : '',
          owner === 'B' ? 'player-b' : '',
          isSelected ? 'selected' : '',
          isMove ? 'move' : '',
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
    </div>
  )
}

export default Board
