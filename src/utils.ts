export type ProgressResponse = {
  type: string
}

export class ProgressPromise<T, P extends ProgressResponse> extends Promise<T> {
  private _progressHandler: ((progress: P) => void) | null = null
  private _progressQueue: P[] = []

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void,
      progress: (value: P) => void
    ) => any
  ) {
    const progressProxy = (progress: P) => {
      if (this._progressHandler && progress) {
        this._progressHandler(progress)
      } else if (progress) {
        this._progressQueue.push(progress)
      }
    }
    super((resolve, reject) => executor(resolve, reject, progressProxy))
    this._progressHandler = null
  }

  progress = (handler: (progress: P) => void) => {
    this._progressHandler = handler
    this._progressQueue.forEach((progress) => {
      this._progressHandler && this._progressHandler(progress)
    })
    this._progressQueue = []
    return this
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): ProgressPromise<TResult1 | TResult2, P> {
    return super.then(onfulfilled, onrejected) as ProgressPromise<
      TResult1 | TResult2,
      P
    >
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): ProgressPromise<T | TResult, P> {
    return super.catch(onrejected) as ProgressPromise<T | TResult, P>
  }
}
