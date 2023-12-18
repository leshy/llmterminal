import fp from 'lodash/fp'

export type AsyncTransform<X, Y> = (x: X) => Promise<Y>
export type Transform<X, Y> = (x: X) => Y

export type MaybeAsyncTransform<X, Y> = AsyncTransform<X, Y> | Transform<X, Y>

export type Cb<X> = (x: X) => Promise<any> | any

// curry pipe
export const cpipe = fp.pipe

export const pipe = <X, Y>(
  input: AsyncGenerator<X>,
  ...chain: Function[]
): //@ts-ignore
Y => fp.pipe(...chain)(input) as Y

export const filter = <X>(f: MaybeAsyncTransform<X, boolean>) =>
  async function* (iterator: AsyncGenerator<X>): AsyncGenerator<X> {
    for await (const el of iterator) {
      if (await f(el)) {
        yield el
      }
    }
  }

export const map = <X, Y>(f: MaybeAsyncTransform<X, Y>) =>
  async function* (iterator: AsyncGenerator<X>): AsyncGenerator<Y> {
    for await (const el of iterator) {
      yield await f(el)
    }
  }

export const probe = <X>(f: Cb<X>) =>
  async function* (iterator: AsyncGenerator<X>): AsyncGenerator<X> {
    for await (const el of iterator) {
      await f(el)
      yield el
    }
  }

export const window = <X>(n: number) =>
  async function* (iterator: AsyncGenerator<X>): AsyncGenerator<X[]> {
    let store: X[] = []
    for await (const el of iterator) {
      store.push(el)
      if (store.length === n) {
        yield store
        store = []
      }
    }
    if (store.length) {
      yield store
    }
  }

export async function* sequence(
  start: number,
  end: number
): AsyncGenerator<number> {
  for (let i = start; i <= end; i++) {
    yield i
  }
}

export const delay = <X>(delayTime: number = 1000) =>
  async function* (iterator: AsyncGenerator<X>): AsyncGenerator<X> {
    for await (const el of iterator) {
      await new Promise((resolve) => setTimeout(resolve, delayTime))
      yield el
    }
  }

export const skip = <PAYLOAD>(start: number) =>
  async function* (node: AsyncGenerator<PAYLOAD>) {
    let counter = 0
    for await (const msg of node) {
      counter++
      if (counter > start) {
        yield msg
      }
    }
  }

export const limit = <PAYLOAD>(end: number) =>
  async function* (node: AsyncGenerator<PAYLOAD>) {
    let counter = 0
    for await (const msg of node) {
      counter++
      yield msg
      if (counter === end) {
        break
      }
    }
  }

export const slice = (start = 0, end = Infinity) =>
  fp.pipe(skip(start), limit(end))

export const pullCount =
  () =>
  async <PAYLOAD>(node: AsyncGenerator<PAYLOAD>): Promise<number> => {
    let cnt = 0
    for await (const msg of node) {
      msg
      cnt++
    }
    return cnt
  }

export const pullAll =
  () =>
  async <PAYLOAD>(node: AsyncGenerator<PAYLOAD>) => {
    for await (const msg of node) {
      msg
    }
  }

export const pullArray =
  () =>
  async <PAYLOAD>(node: AsyncGenerator<PAYLOAD>) => {
    let ret: PAYLOAD[] = []
    for await (const msg of node) {
      ret.push(msg)
    }
    return ret
  }

export const pull = (x?: number) =>
  x ? fp.pipe(limit(x), pullAll()) : pullAll()

type BindBuffer<PAYLOAD> = (cb: (event: PAYLOAD) => any) => any

// iterator that retuns an iterator<iterator>
export type Selector = (msg: any) => string

// iterator that retuns an iterator<iterator>
export type IteratorCallback<X, Y> = (
  streamName: string
) => (input: AsyncGenerator<X>) => AsyncGenerator<Y>

export type MetaIterator<X> = AsyncGenerator<AsyncGenerator<X>>

export const split = <IN, OUT>(
  selector: Selector,
  iteratorCallback: IteratorCallback<IN, OUT>
) =>
  async function* (iterator: AsyncGenerator<IN>): AsyncGenerator<OUT> {
    const streams: { [name: string]: any } = {}

    for await (const msg of iterator) {
      const name = selector(msg)
      if (!streams[name]) {
        streams[name] = iteratorCallback(name)
      }
    }
  }

export async function* emitterGenerator(eventEmitter, eventName) {
  const queue: Array<string> = []
  let resolver

  eventEmitter.on(eventName, (data: string) => {
    if (resolver) {
      resolver(data)
      resolver = null
    } else {
      queue.push(data)
    }
  })

  try {
    while (true) {
      if (queue.length === 0) {
        const result = await new Promise((resolve) => {
          resolver = resolve
        })

        yield result
      } else {
        yield queue.shift()
      }
    }
  } finally {
    eventEmitter.removeAllListeners(eventName)
  }
}
