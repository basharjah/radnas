export const money = (n: number | string | null | undefined): string =>
  '$' + (n == null ? 0 : Number(n)).toLocaleString('en-US')

export const dt = (s: string | null | undefined): string =>
  s ? new Date(s).toLocaleString('en-GB') : '—'

export const date = (s: string | null | undefined): string =>
  s ? new Date(s).toLocaleDateString('en-GB') : '—'
