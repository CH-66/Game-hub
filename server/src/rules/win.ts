import type { PieceMap, PlayerId } from './types.js'

export const getWinner = (
  pieces: PieceMap,
  homeA: Set<string>,
  homeB: Set<string>,
): PlayerId | null => {
  let aComplete = true
  let bComplete = true

  Object.entries(pieces).forEach(([key, owner]) => {
    if (owner === 'A' && !homeB.has(key)) {
      aComplete = false
    }
    if (owner === 'B' && !homeA.has(key)) {
      bComplete = false
    }
  })

  if (aComplete) {
    return 'A'
  }
  if (bComplete) {
    return 'B'
  }
  return null
}
