export const EMOJI_LIST = [
  '\u{1F389}',
  '\u{1F525}',
  '\u{1F60E}',
  '\u{1F44F}',
  '\u{1F605}',
  '\u{1F440}',
] as const

export type AllowedEmoji = (typeof EMOJI_LIST)[number]
