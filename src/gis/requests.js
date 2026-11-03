/** 每个地图实例共用的影像/DEM 请求预算；取消时也清空尚未开始的任务。 */
export function createMapRequests() {
  const controller = new AbortController()
  const queue = []
  let active = 0
  const aborted = () => new DOMException('地图请求已取消', 'AbortError')
  function drain() {
    while (!controller.signal.aborted && active < 6 && queue.length) {
      const { task, resolve, reject } = queue.shift()
      active++
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
      Promise.resolve()
        .then(() => task(signal))
        .then(resolve, reject)
        .finally(() => {
          active--
          drain()
        })
    }
  }
  return {
    get stopped() {
      return controller.signal.aborted
    },
    run(task) {
      if (controller.signal.aborted) return Promise.reject(aborted())
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject })
        drain()
      })
    },
    dispose() {
      controller.abort()
      queue.splice(0).forEach(({ reject }) => reject(aborted()))
    },
  }
}

/** 同时限制错误响应、压缩数据及解压数据，避免把异常大响应留在内存。 */
export async function readLimited(stream, limit) {
  if (!stream) throw new Error('地图服务返回空数据')
  const reader = stream.getReader(),
    chunks = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('地图数据超过大小限制')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
