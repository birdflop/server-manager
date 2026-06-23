import type { BirdflopApi } from '@shared/types'

declare global {
  interface Window {
    api: BirdflopApi
  }
}

export {}
