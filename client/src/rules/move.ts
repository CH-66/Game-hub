import type { Cube, PieceMap } from './types'
import { addCube, DIRECTIONS, keyToCube, posKey, scaleCube } from './board'

export type MoveSet = {
  steps: Set<string>
  jumps: Set<string>
}

const collectJumpMoves = (
  originKey: string,
  pieces: PieceMap,
  positionSet: Set<string>,
): Set<string> => {
  const origin = keyToCube(originKey)
  const reachable = new Set<string>()

  const isOccupied = (key: string) => {
    if (key === originKey) {
      return false
    }
    return pieces[key] !== undefined
  }

  const dfs = (current: Cube) => {
    DIRECTIONS.forEach((dir) => {
      const mid = addCube(current, dir)
      const midKey = posKey(mid)
      if (!isOccupied(midKey)) {
        return
      }
      const dest = addCube(current, scaleCube(dir, 2))
      const destKey = posKey(dest)
      if (!positionSet.has(destKey)) {
        return
      }
      if (isOccupied(destKey)) {
        return
      }
      if (!reachable.has(destKey)) {
        reachable.add(destKey)
        dfs(dest)
      }
    })
  }

  dfs(origin)
  return reachable
}

export const findJumpPath = (
  originKey: string,
  targetKey: string,
  pieces: PieceMap,
  positionSet: Set<string>,
): string[] | null => {
  const visited = new Set<string>([originKey])

  const search = (currentKey: string, path: string[]): string[] | null => {
    if (currentKey === targetKey) {
      return path
    }

    const current = keyToCube(currentKey)
    const isOccupied = (key: string) => {
      if (key === originKey) {
        return false
      }
      return pieces[key] !== undefined
    }

    for (const dir of DIRECTIONS) {
      const mid = addCube(current, dir)
      const midKey = posKey(mid)
      if (!isOccupied(midKey)) {
        continue
      }

      const dest = addCube(current, scaleCube(dir, 2))
      const destKey = posKey(dest)
      if (!positionSet.has(destKey) || isOccupied(destKey) || visited.has(destKey)) {
        continue
      }

      visited.add(destKey)
      const result = search(destKey, [...path, destKey])
      if (result) {
        return result
      }
      visited.delete(destKey)
    }

    return null
  }

  return search(originKey, [originKey])
}

export const getValidMoves = (
  fromKey: string,
  pieces: PieceMap,
  positionSet: Set<string>,
): MoveSet => {
  const steps = new Set<string>()
  const jumps = collectJumpMoves(fromKey, pieces, positionSet)
  const from = keyToCube(fromKey)

  const isOccupied = (key: string) => {
    if (key === fromKey) {
      return false
    }
    return pieces[key] !== undefined
  }

  DIRECTIONS.forEach((dir) => {
    const step = addCube(from, dir)
    const stepKey = posKey(step)
    if (!positionSet.has(stepKey)) {
      return
    }
    if (!isOccupied(stepKey)) {
      steps.add(stepKey)
    }
  })

  return { steps, jumps }
}
