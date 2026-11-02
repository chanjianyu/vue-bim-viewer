import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { createGisPlacement } from '../dist/index.js'

// 独立按 GRS80 椭球公式计算的样例：123°E、41°N，水平旋转 30°，基线 120/90 米。
const models = [
  { x: 100, y: 0, z: 200 },
  { x: 220, y: 0, z: 200 },
  { x: 100, y: 0, z: 110 },
  { x: 220, y: 0, z: 110 },
]
const maps = [
  { longitude: 123, latitude: 41 },
  { longitude: 123.00123520138344, latitude: 41.00054027150777 },
  { longitude: 122.99946514080546, latitude: 41.000701840622 },
  { longitude: 123.00070035092419, latitude: 41.00124211779473 },
]
const controls = models.map((model, index) => ({ model, map: maps[index] }))
const options = { sourceCrs: 'EPSG:4490', controlPoints: controls.slice(0, 3) }
const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} 应接近 ${expected}（${tolerance}）`)
const nearCoordinate = (actual, expected) => {
  near(actual.longitude, expected.longitude, 1e-8)
  near(actual.latitude, expected.latitude, 1e-8)
}

test('公开 ESM/CJS 入口都导出 GIS 方法', () => {
  const require = createRequire(import.meta.url)
  const cjs = require('../dist/index.cjs')
  near(cjs.createGisPlacement(options).rotationDegrees, 30)
})

test('三个点求正确朝向和平移，并预测未参与拟合的第四个点', () => {
  const result = createGisPlacement(options)
  near(result.rotationDegrees, 30)
  nearCoordinate(result.toGeographic(models[3]), maps[3])
  nearCoordinate(result.position, {
    longitude: 122.9977820733506,
    latitude: 41.00110939544285,
  })
  assert.ok(result.horizontalRmse < 1e-5)
  assert.equal(result.heightResolved, false)
  assert.equal(result.verticalRmse, null)
  assert.equal('height' in result.position, false)
  assert.equal('height' in result.toGeographic(models[0]), false)
  assert.deepEqual(
    result.residuals.map((point) => point.verticalError),
    [null, null, null],
  )
})

test('矩阵使用列主序，局部坐标为东、北、上，ECEF 数值匹配独立样例', () => {
  const result = createGisPlacement(options)
  const local = new Matrix4().fromArray(result.localMatrix)
  const origin = new Vector3(...Object.values(models[0])).applyMatrix4(local)
  near(origin.length(), 0, 1e-5)
  const east = new Vector3(...Object.values(models[1])).applyMatrix4(local)
  near(east.x, 120 * Math.cos(Math.PI / 6), 1e-5)
  near(east.y, 60, 1e-5)
  const raised = new Vector3(100, 50, 200).applyMatrix4(local)
  near(raised.z, 50)
  const ecef = new Vector3(100, 0, 200).applyMatrix4(new Matrix4().fromArray(result.ecefMatrix))
  near(ecef.x, -2625482.0389506435, 1e-5)
  near(ecef.y, 4042887.80490457, 1e-5)
  near(ecef.z, 4162423.2005780526, 1e-5)
})

test('Z 向上模型与 Y 向上模型产生相同地理位置', () => {
  const zUp = controls.map(({ model, map }) => ({
    model: { x: model.x, y: -model.z, z: model.y },
    map,
  }))
  const result = createGisPlacement({ ...options, modelUpAxis: 'z', controlPoints: zUp })
  near(result.rotationDegrees, 30)
  zUp.forEach(({ model, map }) => nearCoordinate(result.toGeographic(model), map))
})

test('毫米单位需要显式换算，不能自动拉伸掩盖错误单位', () => {
  const millimeters = controls.map(({ model, map }) => ({
    model: { x: model.x * 1000, y: model.y * 1000, z: model.z * 1000 },
    map,
  }))
  const result = createGisPlacement({
    ...options,
    metersPerUnit: 0.001,
    controlPoints: millimeters,
  })
  nearCoordinate(result.toGeographic(millimeters[3].model), maps[3])
  assert.throws(
    () => createGisPlacement({ ...options, controlPoints: millimeters, maxErrorMeters: 1 }),
    /超过允许值/,
  )
})

test('一个高程控制点即可确定整体竖直偏移，补高程不改变水平矩阵', () => {
  const flat = createGisPlacement(options)
  const elevated = createGisPlacement({
    ...options,
    controlPoints: options.controlPoints.map((point, index) => ({
      model: { ...point.model, y: 10 },
      map: { ...point.map, ...(index === 0 ? { height: 150 } : {}) },
    })),
  })
  assert.equal(elevated.heightResolved, true)
  near(elevated.toGeographic({ ...models[0], y: 10 }).height, 150, 1e-5)
  near(elevated.toGeographic({ ...models[0], y: 35 }).height, 175, 1e-5)
  near(elevated.localMatrix[14], 140, 1e-5)
  near(elevated.verticalRmse, 0, 1e-5)
  assert.equal(elevated.residuals[1].verticalError, null)
  flat.localMatrix.forEach((value, index) => {
    if (index !== 14) near(elevated.localMatrix[index], value)
  })
})

test('多点高程矛盾通过误差报告，不倾斜或拉伸模型去强制贴合', () => {
  const result = createGisPlacement({
    ...options,
    controlPoints: options.controlPoints.map((point, index) => ({
      model: point.model,
      map: { ...point.map, height: index === 2 ? 130 : 100 },
    })),
  })
  near(result.localMatrix[14], 110, 0.01)
  near(result.verticalRmse, Math.sqrt(200), 0.01)
  near(result.rotationDegrees, 30)
  assert.equal(result.residuals.length, 3)
})

test('预览高度不被当作已经完成高程配准', () => {
  const result = createGisPlacement({ ...options, fallbackHeight: 100 })
  near(result.localMatrix[14], 100)
  assert.equal(result.heightResolved, false)
  assert.equal(result.toGeographic(models[0]).height, undefined)
})

test('首点模式固定位置，距离差只进入残差而不拟合比例', () => {
  const input = structuredClone(options)
  input.horizontalAlignment = 'first-point'
  input.controlPoints[1].model.x = 340
  input.controlPoints[2].model.z = 20
  const result = createGisPlacement(input)
  nearCoordinate(result.toGeographic(models[0]), maps[0])
  near(result.rotationDegrees, 30, 1e-6)
  assert.equal(result.metersPerUnit, 1)
  const matrix = new Matrix4().fromArray(result.localMatrix)
  near(new Vector3(1, 0, 0).transformDirection(matrix).length(), 1)
  near(Math.hypot(...result.localMatrix.slice(0, 3)), 1)
  assert.ok(result.maxHorizontalError > 100)
  const normal = createGisPlacement(options)
  assert.deepEqual(
    normal.localMatrix,
    createGisPlacement({ ...options, horizontalAlignment: 'least-squares' }).localMatrix,
  )
})

test('两个方向等权参与，基线长度和竖直差不改变权重', () => {
  const controlPoints = structuredClone(options.controlPoints)
  const rotate = (point, degrees, factor) => {
    const x = point.x - models[0].x,
      north = -(point.z - models[0].z)
    const angle = (degrees * Math.PI) / 180
    return {
      x: models[0].x + factor * (x * Math.cos(angle) - north * Math.sin(angle)),
      y: 5000,
      z: models[0].z - factor * (x * Math.sin(angle) + north * Math.cos(angle)),
    }
  }
  controlPoints[1].model = rotate(models[1], 10, 5)
  controlPoints[2].model = rotate(models[2], -10, 0.5)
  const result = createGisPlacement({
    ...options,
    horizontalAlignment: 'first-point',
    controlPoints,
  })
  near(result.rotationDegrees, 30, 1e-6)
  nearCoordinate(result.toGeographic(models[0]), maps[0])
  const second = structuredClone(controlPoints)
  second[2].model = rotate(models[2], -20, 0.5)
  const changed = createGisPlacement({
    ...options,
    horizontalAlignment: 'first-point',
    controlPoints: second,
  })
  near(changed.rotationDegrees, 35, 1e-6)
})

test('首点预览高度可由宿主对齐为零，不会宣称已完成高程配准', () => {
  const controlPoints = options.controlPoints.map((point) => ({
    ...point,
    model: { ...point.model, y: 60 },
  }))
  const result = createGisPlacement({
    ...options,
    controlPoints,
    horizontalAlignment: 'first-point',
    fallbackHeight: -60,
  })
  const anchor = new Vector3(100, 60, 200).applyMatrix4(new Matrix4().fromArray(result.localMatrix))
  near(anchor.length(), 0, 1e-5)
  assert.equal(result.heightResolved, false)
  nearCoordinate(result.toGeographic(controlPoints[0].model), maps[0])
  assert.throws(
    () => createGisPlacement({ ...options, horizontalAlignment: 'unknown' }),
    /horizontalAlignment/,
  )
  const contradictory = structuredClone(options.controlPoints)
  contradictory[2].model.z = 290
  assert.throws(
    () =>
      createGisPlacement({
        ...options,
        horizontalAlignment: 'first-point',
        controlPoints: contradictory,
      }),
    /无法确定/,
  )
})

test('首点模式允许可定向的共线控制点，但拒绝与首点重合的方向点', () => {
  const input = {
    sourceCrs: 'EPSG:4326',
    modelUpAxis: 'z',
    horizontalAlignment: 'first-point',
    controlPoints: [0, 1, 2].map((index) => ({
      model: { x: index * 100, y: 0, z: 0 },
      map: { longitude: 123 + index * 0.001, latitude: 0 },
    })),
  }
  const result = createGisPlacement(input)
  near(result.rotationDegrees, 0, 1e-6)
  nearCoordinate(result.toGeographic(input.controlPoints[0].model), input.controlPoints[0].map)
  input.controlPoints[1].model.x = 0
  assert.throws(() => createGisPlacement(input), /水平面上重合/)
})

test('支持四点最小二乘及误差阈值，能发现错误对应点', () => {
  const noisy = controls.map((point, index) => ({
    model: point.model,
    map: { ...point.map, longitude: point.map.longitude + (index === 3 ? 0.0001 : 0) },
  }))
  const result = createGisPlacement({ ...options, controlPoints: noisy })
  assert.equal(result.residuals.length, 4)
  assert.ok(result.horizontalRmse > 1)
  assert.ok(result.maxHorizontalError >= result.horizontalRmse)
  assert.throws(
    () => createGisPlacement({ ...options, controlPoints: noisy, maxErrorMeters: 1 }),
    /超过允许值/,
  )
})

test('EPSG:4529 使用测量 X/Y 正确轴序，真实三井口反算落在预期经纬度', () => {
  const result = createGisPlacement({
    sourceCrs: 'EPSG:4529',
    modelUpAxis: 'z',
    controlPoints: [
      { model: { x: 0, y: 0, z: 0 }, map: { northing: 4553676.771, easting: 41508910.967 } },
      {
        model: { x: 837.633, y: -964.671, z: 0 },
        map: { northing: 4552712.1, easting: 41509748.6 },
      },
      {
        model: { x: -545.967, y: 941.229, z: 0 },
        map: { northing: 4554618, easting: 41508365 },
      },
    ],
  })
  nearCoordinate(result.toGeographic({ x: 0, y: 0, z: 0 }), {
    longitude: 123.10610184124921,
    latitude: 41.11794199646031,
  })
  assert.ok(result.maxHorizontalError < 0.01)
  nearCoordinate(result.toGeographic({ x: 837.633, y: -964.671, z: 0 }), {
    longitude: 123.11606012072886,
    latitude: 41.10924605746759,
  })
})

test('支持 WGS84 经纬度输入，输入快照及返回矩阵的修改不会影响转换闭包', () => {
  const input = structuredClone(options)
  input.sourceCrs = 'EPSG:4326'
  const saved = structuredClone(input)
  const result = createGisPlacement(input)
  assert.deepEqual(input, saved)
  const before = result.toGeographic(models[3])
  input.controlPoints[0].model.x = 999999
  result.ecefMatrix.fill(0)
  result.localMatrix.fill(0)
  result.reference.longitude = 0
  assert.deepEqual(result.toGeographic(models[3]), before)
  nearCoordinate(before, maps[3])
})

test('拒绝缺失、非有限数值、未知坐标系和非法选项', () => {
  assert.throws(() => createGisPlacement(null), /至少需要三个/)
  assert.throws(
    () => createGisPlacement({ ...options, controlPoints: controls.slice(0, 2) }),
    /三个/,
  )
  assert.throws(() => createGisPlacement({ ...options, sourceCrs: 'EPSG:3857' }), /不支持的坐标系/)
  assert.throws(() => createGisPlacement({ ...options, modelUpAxis: 'x' }), /仅支持/)
  for (const metersPerUnit of [0, -1, NaN, Infinity])
    assert.throws(() => createGisPlacement({ ...options, metersPerUnit }), /metersPerUnit/)
  for (const maxErrorMeters of [-1, NaN, Infinity])
    assert.throws(() => createGisPlacement({ ...options, maxErrorMeters }), /maxErrorMeters/)
  assert.throws(() => createGisPlacement({ ...options, fallbackHeight: NaN }), /fallbackHeight/)
  const invalid = structuredClone(options)
  invalid.controlPoints[1].model.x = NaN
  assert.throws(() => createGisPlacement(invalid), /模型 x/)
  invalid.controlPoints[1].model.x = 220
  invalid.controlPoints[1].map.longitude = 999
  assert.throws(() => createGisPlacement(invalid), /超出有效范围/)
  invalid.controlPoints[1].map.longitude = 123
  invalid.controlPoints[1].map.height = Infinity
  assert.throws(() => createGisPlacement(invalid), /高程/)
  assert.throws(() => createGisPlacement(options).toGeographic({ x: 0, y: 0, z: NaN }), /模型 z/)
})

test('拒绝模型点或地图点重合及共线，拒绝缺带号或颠倒的测量坐标', () => {
  assert.throws(
    () =>
      createGisPlacement({
        ...options,
        controlPoints: controls.map(({ map }, index) => ({ model: { x: index, y: 0, z: 0 }, map })),
      }),
    /模型控制点.*共线/,
  )
  assert.throws(
    () =>
      createGisPlacement({
        ...options,
        controlPoints: controls.map(({ model }, index) => ({
          model,
          map: { longitude: 123 + index * 0.001, latitude: 0 },
        })),
      }),
    /地图控制点.*共线/,
  )
  for (const easting of [508910.967, 4553676.771])
    assert.throws(
      () =>
        createGisPlacement({
          sourceCrs: 'EPSG:4529',
          controlPoints: models.map((model) => ({
            model,
            map: { northing: 4553676.771, easting },
          })),
        }),
      /41 带号/,
    )
})
