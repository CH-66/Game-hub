import type { Axial, Cube, PieceMap } from './types.js'

export const DIRECTIONS: Cube[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
]

export const addCube = (a: Cube, b: Cube): Cube => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

export const scaleCube = (a: Cube, k: number): Cube => ({
  x: a.x * k,
  y: a.y * k,
  z: a.z * k,
})

export const posKey = (cube: Cube): string => `${cube.x},${cube.y},${cube.z}`

export const keyToCube = (key: string): Cube => {
  const [x, y, z] = key.split(',').map(Number)
  return { x, y, z }
}

export const cubeToAxial = (cube: Cube): Axial => ({
  q: cube.x,
  r: cube.z,
})

const generateCenterHex = (size: number): Cube[] => {
  const cells: Cube[] = []
  for (let x = -size; x <= size; x += 1) {
    for (let y = -size; y <= size; y += 1) {
      const z = -x - y
      const maxAxis = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
      if (maxAxis <= size) {
        cells.push({ x, y, z })
      }
    }
  }
  return cells
}

const generateAxisTriangle = (size: number, axis: 'x' | 'y' | 'z'): Cube[] => {
  const cells: Cube[] = []
  const min = size + 1
  const max = size * 2

  if (axis === 'x') {
    for (let x = min; x <= max; x += 1) {
      for (let y = -size; y <= -(x - size); y += 1) {
        const z = -x - y
        cells.push({ x, y, z })
      }
    }
  }

  if (axis === 'y') {
    for (let y = min; y <= max; y += 1) {
      for (let z = -size; z <= -(y - size); z += 1) {
        const x = -y - z
        cells.push({ x, y, z })
      }
    }
  }

  if (axis === 'z') {
    for (let z = min; z <= max; z += 1) {
      for (let x = -size; x <= -(z - size); x += 1) {
        const y = -z - x
        cells.push({ x, y, z })
      }
    }
  }

  return cells
}

const mirrorTriangle = (cells: Cube[]): Cube[] =>
  cells.map((cell) => ({ x: -cell.x, y: -cell.y, z: -cell.z }))

export type BoardState = {
  size: number
  positions: Cube[]
  positionSet: Set<string>
  homeA: Set<string>
  homeB: Set<string>
}

export const createBoard = (size: number): BoardState => {
  const cells = new Map<string, Cube>()
  const center = generateCenterHex(size)
  center.forEach((cube) => {
    cells.set(posKey(cube), cube)
  })

  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
  axes.forEach((axis) => {
    const tri = generateAxisTriangle(size, axis)
    tri.forEach((cube) => {
      cells.set(posKey(cube), cube)
    })
    mirrorTriangle(tri).forEach((cube) => {
      cells.set(posKey(cube), cube)
    })
  })

  const positions = Array.from(cells.values())
  positions.sort((a, b) => (a.z === b.z ? a.x - b.x : a.z - b.z))

  const homeB = new Set(generateAxisTriangle(size, 'z').map(posKey))
  const homeA = new Set(mirrorTriangle(generateAxisTriangle(size, 'z')).map(posKey))

  return {
    size,
    positions,
    positionSet: new Set(cells.keys()),
    homeA,
    homeB,
  }
}

export const createInitialPieces = (board: BoardState): PieceMap => {
  const pieces: PieceMap = {}
  board.homeA.forEach((key) => {
    pieces[key] = 'A'
  })
  board.homeB.forEach((key) => {
    pieces[key] = 'B'
  })
  return pieces
}
