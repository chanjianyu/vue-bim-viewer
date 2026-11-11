import proj4 from 'proj4'
import { Matrix4, Vector3 } from 'three'

const geographic2000 = '+proj=longlat +ellps=GRS80 +no_defs'
const geographicWgs84 = '+proj=longlat +datum=WGS84 +no_defs'
const zone41 =
  '+proj=tmerc +lat_0=0 +lon_0=123 +k=1 +x_0=41500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`)
}

function modelPoint(value) {
  if (!value) throw new Error('缺少模型坐标')
  finite(value.x, '模型 x')
  finite(value.y, '模型 y')
  finite(value.z, '模型 z')
  return new Vector3(value.x, value.y, value.z)
}

function geographicPoint(value) {
  finite(value.longitude, '经度')
  finite(value.latitude, '纬度')
  if (Math.abs(value.longitude) > 180 || Math.abs(value.latitude) > 90)
    throw new Error('经纬度超出有效范围')
  if (value.height !== undefined) finite(value.height, '高程')
  return { ...value }
}

function center(points) {
  return points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length)
}

function checkSpread(points, mean, label) {
  let xx = 0,
    yy = 0,
    xy = 0
  for (const point of points) {
    const x = point.x - mean.x,
      y = point.y - mean.y
    xx += x * x
    yy += y * y
    xy += x * y
  }
  if (xx + yy < 1e-12 || xx * yy - xy * xy <= 1e-12 * (xx + yy) ** 2)
    throw new Error(`${label}在水平面上重合、共线或过于接近共线，请选择分散的控制点`)
}

/** 三点或多点水平配准：支持整体最小二乘和首点锚定，保持竖直及尺寸。 */
export function createGisPlacement(options) {
  if (!options || !Array.isArray(options.controlPoints) || options.controlPoints.length < 3)
    throw new Error('GIS 配准至少需要三个模型与地图的对应控制点')
  const { sourceCrs } = options
  if (!['EPSG:4490', 'EPSG:4326', 'EPSG:4529'].includes(sourceCrs))
    throw new Error('不支持的坐标系，请显式指定 EPSG:4490、EPSG:4326 或 EPSG:4529')
  const up = options.modelUpAxis ?? 'y'
  const alignment = options.horizontalAlignment ?? 'least-squares'
  if (!['least-squares', 'first-point'].includes(alignment))
    throw new Error('horizontalAlignment 仅支持 least-squares 或 first-point')
  if (up !== 'y' && up !== 'z') throw new Error('modelUpAxis 仅支持 y 或 z')
  const scale = options.metersPerUnit ?? 1
  finite(scale, 'metersPerUnit')
  if (scale <= 0) throw new Error('metersPerUnit 必须大于 0')
  const fallbackHeight = options.fallbackHeight ?? 0
  finite(fallbackHeight, 'fallbackHeight')
  if (options.maxErrorMeters !== undefined) {
    finite(options.maxErrorMeters, 'maxErrorMeters')
    if (options.maxErrorMeters < 0) throw new Error('maxErrorMeters 不能为负数')
  }

  const geographic = sourceCrs === 'EPSG:4326' ? geographicWgs84 : geographic2000
  const surveyProjection = proj4(zone41, geographic2000)
  const geocentric = proj4(
    geographic,
    `+proj=geocent +ellps=${sourceCrs === 'EPSG:4326' ? 'WGS84' : 'GRS80'} +units=m +no_defs`,
  )
  const controls = options.controlPoints.map((point) => {
    const model = modelPoint(point?.model)
    if (!point.map) throw new Error('缺少地图坐标')
    let map
    if (sourceCrs === 'EPSG:4529') {
      const survey = point.map
      finite(survey.northing, 'northing（测量 X）')
      finite(survey.easting, 'easting（测量 Y）')
      if (Math.floor(survey.easting / 1000000) !== 41)
        throw new Error('EPSG:4529 的 easting（测量 Y）必须包含 41 带号')
      const [longitude, latitude] = surveyProjection.forward([survey.easting, survey.northing])
      map = geographicPoint({ longitude, latitude, height: survey.height })
    } else map = geographicPoint(point.map)
    return { model, map }
  })

  const reference = {
    longitude: controls[0].map.longitude,
    latitude: controls[0].map.latitude,
    height: 0,
  }
  const radians = Math.PI / 180
  const longitude = reference.longitude * radians,
    latitude = reference.latitude * radians
  const sinLon = Math.sin(longitude),
    cosLon = Math.cos(longitude),
    sinLat = Math.sin(latitude),
    cosLat = Math.cos(latitude)
  const cartesian = (point, height) =>
    new Vector3(...geocentric.forward([point.longitude, point.latitude, height]))
  const anchor = cartesian(reference, 0)
  // 列分别为东、北、上单位向量，平移为基准点的 ECEF 坐标。
  const enuToEcef = new Matrix4().set(
    -sinLon,
    -sinLat * cosLon,
    cosLat * cosLon,
    anchor.x,
    cosLon,
    -sinLat * sinLon,
    cosLat * sinLon,
    anchor.y,
    0,
    cosLat,
    sinLat,
    anchor.z,
    0,
    0,
    0,
    1,
  )
  const ecefToEnu = enuToEcef.clone().invert()
  const axis = up === 'y' ? new Matrix4().makeRotationX(Math.PI / 2) : new Matrix4()
  const source = controls.map(({ model }) => model.clone().applyMatrix4(axis).multiplyScalar(scale))
  // 水平拟合统一使用椭球面，后续补高程不会改变已求出的水平位置与角度。
  const target = controls.map(({ map }) => cartesian(map, 0).applyMatrix4(ecefToEnu))
  const sourceCenter = center(source),
    targetCenter = center(target)
  // 保留原模式的分布约束；首点模式只需非零方向且合成方向不抵消，共线仍可定向。
  if (alignment === 'least-squares') {
    checkSpread(source, sourceCenter, '模型控制点')
    checkSpread(target, targetCenter, '地图控制点')
  }
  const sourceOrigin = alignment === 'first-point' ? source[0] : sourceCenter,
    targetOrigin = alignment === 'first-point' ? target[0] : targetCenter
  let dot = 0,
    cross = 0
  for (let i = alignment === 'first-point' ? 1 : 0; i < source.length; i++) {
    const p = source[i].clone().sub(sourceOrigin),
      q = target[i].clone().sub(targetOrigin)
    if (alignment === 'first-point') {
      // 只比较水平朝向；不能用 Vector3.normalize，否则竖直差会改变两个方向的权重。
      const pLength = Math.hypot(p.x, p.y),
        qLength = Math.hypot(q.x, q.y)
      if (pLength < 1e-6 || qLength < 1e-6) throw new Error('方向控制点不能与首点在水平面上重合')
      p.divideScalar(pLength)
      q.divideScalar(qLength)
    }
    dot += p.x * q.x + p.y * q.y
    cross += p.x * q.y - p.y * q.x
  }
  // 单位方向近乎相互抵消时，椭球换算的浮点尾差不能被误当成有效朝向。
  const directionTolerance = alignment === 'first-point' ? 1e-8 * (source.length - 1) : 1e-12
  if (Math.hypot(dot, cross) < directionTolerance) throw new Error('控制点无法确定一致的水平旋转')
  const angle = Math.atan2(cross, dot)
  const rotation = new Matrix4().makeRotationZ(angle)
  const translation = targetOrigin.clone().sub(sourceOrigin.clone().applyMatrix4(rotation))
  const heightOffsets = controls.flatMap(({ map }, index) =>
    map.height === undefined
      ? []
      : [{ index, z: cartesian(map, map.height).applyMatrix4(ecefToEnu).z }],
  )
  const heightResolved = heightOffsets.length > 0
  translation.z = heightResolved
    ? heightOffsets.reduce((sum, point) => sum + point.z - source[point.index].z, 0) /
      heightOffsets.length
    : fallbackHeight
  const localMatrix = new Matrix4()
    .makeTranslation(translation.x, translation.y, translation.z)
    .multiply(rotation)
    .multiply(axis)
    .scale(new Vector3(scale, scale, scale))
  const ecefMatrix = enuToEcef.clone().multiply(localMatrix)
  const toGeographic = (point) => {
    const position = modelPoint(point).applyMatrix4(ecefMatrix)
    const [longitude, latitude, height] = geocentric.inverse(position.toArray())
    return geographicPoint({ longitude, latitude, ...(heightResolved ? { height } : {}) })
  }
  const residuals = controls.map(({ model, map }, index) => {
    // 在同一椭球面上计算水平残差，包含局部刚性放置带来的曲率误差。
    const coordinate = toGeographic(model)
    const actual = cartesian(coordinate, 0).applyMatrix4(ecefToEnu)
    const verticalError = map.height === undefined ? null : coordinate.height - map.height
    return {
      index,
      horizontalError: Math.hypot(actual.x - target[index].x, actual.y - target[index].y),
      verticalError,
    }
  })
  const horizontalRmse = Math.sqrt(
    residuals.reduce((sum, point) => sum + point.horizontalError ** 2, 0) / residuals.length,
  )
  const maxHorizontalError = Math.max(...residuals.map((point) => point.horizontalError))
  if (options.maxErrorMeters !== undefined && maxHorizontalError > options.maxErrorMeters)
    throw new Error(`控制点最大水平误差 ${maxHorizontalError.toFixed(4)} 米超过允许值`)
  const verticalErrors = residuals.filter((point) => point.verticalError !== null)
  return {
    sourceCrs,
    reference: { ...reference },
    position: toGeographic({ x: 0, y: 0, z: 0 }),
    rotationDegrees: angle / radians,
    metersPerUnit: scale,
    heightResolved,
    localMatrix: localMatrix.toArray(),
    ecefMatrix: ecefMatrix.toArray(),
    horizontalRmse,
    maxHorizontalError,
    verticalRmse: verticalErrors.length
      ? Math.sqrt(
          verticalErrors.reduce((sum, point) => sum + point.verticalError ** 2, 0) /
            verticalErrors.length,
        )
      : null,
    residuals,
    toGeographic,
  }
}
