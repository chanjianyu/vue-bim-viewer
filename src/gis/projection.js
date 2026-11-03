import proj4 from 'proj4'
import { Box3, Matrix4, PlaneGeometry, Vector3 } from 'three'

/** 有限矿区地图的坐标适配；模型节点始终保留原始坐标。 */

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
  const project = (longitude, latitude, height = 0, absolute = false) => {
    const point = new Vector3(
      ...geographic.forward([longitude, latitude, absolute ? height : 0]),
    ).applyMatrix4(ecefToEnu)
    // 平面/相对预览保留原水平位置；真实高程模式保留 ECEF -> ENU 的完整结果。
    if (!absolute) point.z = height
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
  return {
    tiles,
    project,
    bounds,
    reference: placement.reference,
    heightResolved: placement.heightResolved,
  }
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
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
