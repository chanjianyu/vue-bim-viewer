import { readLimited } from './requests.js'
import { tileGeographic } from './projection.js'

// 天地图官方 GeoTerrainProvider 使用 zlib + 150x150 小端 UInt16 高程；不是 quantized-mesh。
// 只启用本矿区实际取得有效响应的最高级别 12；不把更高级别的空响应当成平地。
const size = 150
const maxLevel = 12
const cacheLimit = 64 * 1024 * 1024

export async function decodeTerrain(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0x78 || ((bytes[0] << 8) + bytes[1]) % 31)
    throw new Error('天地图 DEM 不是受支持的 zlib 高程栅格')
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DEM 解压')
  const raw = await readLimited(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')),
    size * size * 2,
  )
  if (raw.byteLength !== size * size * 2) throw new Error('天地图 DEM 栅格长度不正确')
  const view = new DataView(raw.buffer),
    heights = new Float32Array(size * size)
  for (let i = 0; i < heights.length; i++) {
    const value = view.getUint16(i * 2, true)
    // 官方实现把超过 10000 的无效值置零；这里保留缺测，禁止制造平地或错误基准。
    heights[i] = value <= 10000 ? value : NaN
  }
  return heights
}

/** c 矩阵的 service level 比 Cesium GeographicTilingScheme level 大 1；行向南。 */
export function terrainCoordinate(longitude, latitude, level) {
  const n = 2 ** level
  const x = ((longitude + 180) / 360) * n,
    y = ((90 - latitude) / 360) * n
  // 在边界统一选西/北侧，保证两张影像在共享顶点上查询完全相同的数据。
  const index = (v, limit) => Math.max(0, Math.min(limit, Math.ceil(v - 1e-10) - 1))
  const tx = index(x, n - 1),
    ty = index(y, n / 2 - 1)
  return {
    x: tx,
    y: ty,
    level,
    u: Math.max(0, Math.min(1, x - tx)),
    v: Math.max(0, Math.min(1, y - ty)),
  }
}

export function sampleTerrain(heights, u, v) {
  const x = Math.max(0, Math.min(149, u * 149)),
    y = Math.max(0, Math.min(149, v * 149))
  const ix = Math.min(148, Math.floor(x)),
    iy = Math.min(148, Math.floor(y))
  const fx = x - ix,
    fy = y - iy,
    i = iy * size + ix
  const values =
    fx + fy <= 1
      ? [
          [heights[i], 1 - fx - fy],
          [heights[i + 1], fx],
          [heights[i + size], fy],
        ]
      : [
          [heights[i + size + 1], fx + fy - 1],
          [heights[i + size], 1 - fx],
          [heights[i + 1], 1 - fy],
        ]
  let height = 0
  for (const [value, weight] of values) {
    if (weight <= 1e-12) continue
    if (!Number.isFinite(value)) throw new Error('DEM 采样点缺少有效高程')
    height += value * weight
  }
  return height
}

export function createTerrainSource(plan, options, key, requests) {
  const level = Math.min(maxLevel, plan.tiles[0].zoom)
  if (level < 6) throw new Error('当前地图范围过大，DEM 仅支持影像级别 6 及以上')
  if (
    options.mode === 'absolute' &&
    (!plan.heightResolved || typeof options.toEllipsoidHeight !== 'function')
  )
    throw new Error('真实高程模式需要可靠高程配准和 toEllipsoidHeight 转换函数')
  const cache = new Map()
  let cachedBytes = 0,
    stopped = false,
    baseline
  function trim() {
    for (const [id, entry] of cache) {
      if (cachedBytes <= cacheLimit) break
      if (entry.refs || !entry.data) continue
      cachedBytes -= entry.data.byteLength
      cache.delete(id)
    }
  }
  function acquire(coord) {
    const id = `${coord.x}/${coord.y}`
    let entry = cache.get(id)
    if (!entry) {
      entry = { refs: 0 }
      cache.set(id, entry)
      entry.promise = requests.run(async (signal) => {
        const url = new URL('https://t0.tianditu.gov.cn/mapservice/swdx')
        url.search = new URLSearchParams({ T: 'elv_c', tk: key, x: coord.x, y: coord.y, l: level })
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error('DEM 请求失败')
        const bytes = await readLimited(response.body, 1024 * 1024)
        const data = await decodeTerrain(bytes)
        if (stopped || signal.aborted) throw new Error('DEM 请求已取消')
        entry.data = data
        cachedBytes += data.byteLength
        trim()
        return data
      })
      // 失败结果也保留，避免多个目标瓦片反复请求同一失效源。
    } else {
      cache.delete(id)
      cache.set(id, entry)
    }
    entry.refs++
    return {
      promise: entry.promise,
      release() {
        entry.refs--
        trim()
      },
    }
  }
  async function at(longitude, latitude) {
    const coord = terrainCoordinate(longitude, latitude, level),
      ref = acquire(coord)
    try {
      return sampleTerrain(await ref.promise, coord.u, coord.v)
    } finally {
      ref.release()
    }
  }
  return {
    async prepare(tile) {
      if (options.mode !== 'absolute') {
        baseline ??= at(plan.reference.longitude, plan.reference.latitude).catch(() => {
          throw new Error('DEM 基准高程获取失败，整层保持平面影像')
        })
      }
      const base = baseline ? await baseline : 0
      if (stopped) throw new Error('DEM 已关闭')
      const coords = [],
        refs = new Map()
      try {
        for (let row = 0; row <= 32; row++)
          for (let col = 0; col <= 32; col++) {
            const p = tileGeographic(tile.x + col / 32, tile.y + row / 32, tile.zoom)
            const coord = terrainCoordinate(p.longitude, p.latitude, level)
            const id = `${coord.x}/${coord.y}`
            if (!refs.has(id)) refs.set(id, acquire(coord))
            coords.push({ ...p, ...coord, id })
          }
        const entries = await Promise.all(
          [...refs].map(async ([id, ref]) => [id, await ref.promise]),
        )
        if (stopped) throw new Error('DEM 已关闭')
        const data = new Map(entries),
          heights = new Float64Array(coords.length)
        coords.forEach((coord, i) => {
          const height = sampleTerrain(data.get(coord.id), coord.u, coord.v)
          if (options.mode === 'absolute') {
            try {
              heights[i] = options.toEllipsoidHeight({
                longitude: coord.longitude,
                latitude: coord.latitude,
                height,
              })
            } catch {
              throw new Error('DEM 高程基准转换失败')
            }
            if (!Number.isFinite(heights[i])) throw new Error('DEM 高程转换必须返回有限的椭球高')
          } else heights[i] = height - base
        })
        return heights
      } finally {
        refs.forEach((ref) => ref.release())
      }
    },
    dispose() {
      stopped = true
      cache.clear()
      cachedBytes = 0
    },
  }
}
