import { ProgressResponse } from './utils'

export interface Module {
  init: () => Promise<void>
}

export type ProgressMessageResponse = {
  type: 'message'
  message: string
}
