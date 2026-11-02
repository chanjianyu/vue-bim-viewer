import proj4 from 'proj4'
import {
  Box3,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'

/** 可选的有限矿区影像层。Key 与配准结果均由宿主提供，不加载地形或地图注记。 */

const radians = Math.PI / 180
const maxLatitude = 85.0511287798066

/** WMTS w 矩阵：列向东、行向南。小数行列用于构造瓦片内部网格。 */
export function tileCoordinate(longitude, latitude, zoom) {
  const count = 2 ** zoom
  const clamped = Math.max(-maxLatitude, Math.min(maxLatitude, latitude))
  return {
    x: ((longitude + 180) / 360) * count,
    y: ((1 - Math.asinh(Math.tan(clamped * radians)) / Math.PI) / 2) * count,
  }
}

export function tileGeographic(x, y, zoom) {
  const count = 2 ** zoom
  return {
    longitude: (x / count) * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / count))) / radians,
  }
}

export function tileUrl(tile, key) {
  const query = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: 'img',
    STYLE: 'default',
    TILEMATRIXSET: 'w',
    FORMAT: 'tiles',
    TILEMATRIX: String(tile.zoom),
    TILEROW: String(tile.y),
    TILECOL: String(tile.x),
    tk: key,
  })
  return `https://t0.tianditu.gov.cn/img_w/wmts?${query}`
}

/**
 * rawBounds 为原始模型空间范围；所有地图顶点转换到 raw + offset 展示空间。
 * 不给模型套地理矩阵，因此构件锚点、Marker 和外观持久化仍沿用原坐标。
 */
export function createImageryPlan(rawBounds, placement, offset) {
  if (rawBounds.isEmpty()) throw new Error('模型没有可用于确定地图范围的几何')
  for (const values of [placement.localMatrix, placement.ecefMatrix]) {
    if (values?.length !== 16 || !values.every(Number.isFinite))
      throw new Error('GIS 配准矩阵必须包含 16 个有限数值')
  }
  const local = new Matrix4().fromArray(placement.localMatrix)
  const ecef = new Matrix4().fromArray(placement.ecefMatrix)
  if (Math.abs(local.determinant()) < 1e-20 || Math.abs(ecef.determinant()) < 1e-20)
    throw new Error('GIS 配准矩阵不可逆')
  const toRaw = local.clone().invert()
  // ECEF = enuToEcef * local。复用配准计算的参考系，避免另造一套轴序。
  const enuToEcef = ecef.clone().multiply(toRaw)
  const ecefToEnu = enuToEcef.clone().invert()
  const ellipsoid = placement.sourceCrs === 'EPSG:4326' ? 'WGS84' : 'GRS80'
  const geographic = proj4(
    `+proj=longlat +ellps=${ellipsoid} +no_defs`,
    `+proj=geocent +ellps=${ellipsoid} +units=m +no_defs`,
  )
  const extent = rawBounds.clone().applyMatrix4(local)
  extent.min.x -= 1000
  extent.min.y -= 1000
  extent.max.x += 1000
  extent.max.y += 1000
  const corners = [
    [extent.min.x, extent.min.y],
    [extent.min.x, extent.max.y],
    [extent.max.x, extent.min.y],
    [extent.max.x, extent.max.y],
  ].map(([x, y]) => {
    const point = new Vector3(x, y, 0).applyMatrix4(enuToEcef)
    const [longitude, latitude] = geographic.inverse(point.toArray())
    return { longitude, latitude }
  })
  if (
    Math.max(...corners.map((p) => p.longitude)) - Math.min(...corners.map((p) => p.longitude)) >
    180
  )
    throw new Error('当前局部影像层不支持跨越日期变更线的范围')
  let tiles = []
  // ponytail: 只加载模型附近的固定范围；以后确有远距离漫游需求再增加相机 LOD。
  for (let zoom = 16; zoom >= 0; zoom--) {
    const coords = corners.map((p) => tileCoordinate(p.longitude, p.latitude, zoom))
    const limit = 2 ** zoom - 1
    const clamp = (value) => Math.max(0, Math.min(limit, Math.floor(value)))
    const minX = clamp(Math.min(...coords.map((p) => p.x)))
    const maxX = clamp(Math.max(...coords.map((p) => p.x)))
    const minY = clamp(Math.min(...coords.map((p) => p.y)))
    const maxY = clamp(Math.max(...coords.map((p) => p.y)))
    if ((maxX - minX + 1) * (maxY - minY + 1) > 256) continue
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) tiles.push({ x, y, zoom })
    break
  }
  const project = (longitude, latitude) => {
    const point = new Vector3(...geographic.forward([longitude, latitude, 0])).applyMatrix4(
      ecefToEnu,
    )
    // 本版为局部平面预览：丢弃椭球曲率和高程，统一铺在 ENU up=0 上。
    point.z = 0
    return point.applyMatrix4(toRaw).add(offset)
  }
  const bounds = new Box3()
  for (const tile of tiles) {
    for (const [dx, dy] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      const p = tileGeographic(tile.x + dx, tile.y + dy, tile.zoom)
      bounds.expandByPoint(project(p.longitude, p.latitude))
    }
  }
  return { tiles, project, bounds }
}

/** UV 的 v=1 对应图片北边；网格细分后逐顶点投影，避免整张影像仅作平移旋转。 */
export function createTileGeometry(tile, project) {
  const geometry = new PlaneGeometry(1, 1, 8, 8)
  const positions = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) {
    const p = tileGeographic(tile.x + uv.getX(i), tile.y + 1 - uv.getY(i), tile.zoom)
    const point = project(p.longitude, p.latitude)
    positions.setXYZ(i, point.x, point.y, point.z)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** 每个实例拥有自己的请求、纹理与分组；关闭后迟到的解码结果也必须释放。 */
export function createImageryLayer(plan, key, opacity, onStatus, invalidate) {
  const root = new Group()
  root.name = 'GIS imagery'
  const pending = new AbortController()
  let disposed = false,
    cursor = 0,
    loaded = 0,
    failed = 0,
    lastError = ''
  const meshes = []
  const emit = (status) => {
    if (!disposed)
      onStatus({
        status,
        loaded,
        failed,
        total: plan.tiles.length,
        ...(failed ? { message: lastError } : {}),
      })
  }
  async function worker() {
    while (!disposed && cursor < plan.tiles.length) {
      const tile = plan.tiles[cursor++]
      let bitmap
      try {
        const response = await fetch(tileUrl(tile, key), { signal: pending.signal })
        if (!response.ok)
          throw new Error(`影像请求失败（HTTP ${response.status}），请检查 Key、权限或网络`)
        if (!response.headers.get('content-type')?.startsWith('image/'))
          throw new Error('影像服务未返回图片，请检查天地图 Key 与服务权限')
        // ImageBitmap 不响应 Texture.flipY，必须在解码阶段翻转到 WebGL UV 方向。
        bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' })
        if (disposed) {
          bitmap.close()
          return
        }
        const texture = new Texture(bitmap)
        texture.flipY = false
        texture.colorSpace = SRGBColorSpace
        texture.needsUpdate = true
        const mesh = new Mesh(
          createTileGeometry(tile, plan.project),
          new MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity,
            side: DoubleSide,
            depthWrite: false,
            toneMapped: false,
          }),
        )
        root.add(mesh)
        meshes.push(mesh)
        bitmap = undefined // 所有权交给材质，dispose 时连同 GPU 纹理一起释放。
        loaded++
        invalidate()
      } catch (cause) {
        bitmap?.close()
        if (disposed) return
        failed++
        // 不透传包含请求 URL 的异常，避免把 Key 写入宿主状态或日志。
        lastError =
          cause instanceof Error && !cause.message.includes('://')
            ? cause.message
            : '影像加载失败，请检查网络、跨域或服务权限'
      }
      emit('loading')
    }
  }
  emit('loading')
  void Promise.all(Array.from({ length: Math.min(6, plan.tiles.length) }, () => worker())).then(
    () => {
      emit(failed ? (loaded ? 'partial' : 'error') : 'ready')
    },
  )
  return {
    root,
    bounds: plan.bounds,
    setOpacity(value) {
      opacity = value
      meshes.forEach((mesh) => {
        mesh.material.opacity = opacity
      })
      invalidate()
    },
    dispose() {
      if (disposed) return
      disposed = true
      pending.abort()
      root.removeFromParent()
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.material.map?.dispose()
        mesh.material.map?.image?.close()
        mesh.material.dispose()
      }
      meshes.length = 0
      root.clear()
    },
  }
}
