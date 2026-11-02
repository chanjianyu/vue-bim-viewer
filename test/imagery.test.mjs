import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Vector3 } from 'three'
import { createGisPlacement } from '../dist/index.js'
// Node 24 直接读取内部 TS 模块，公开包仍只暴露既定 SDK 接口，不为测试扩充 exports。
import {
  createImageryLayer,
  createImageryPlan,
  createTileGeometry,
  tileCoordinate,
  tileGeographic,
  tileUrl,
} from '../src/gis-imagery.js'

function mockBitmap(t, implementation) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: implementation,
    configurable: true,
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'createImageBitmap', original)
    else delete globalThis.createImageBitmap
  })
}

const placement = createGisPlacement({
  sourceCrs: 'EPSG:4490',
  horizontalAlignment: 'first-point',
  fallbackHeight: -60,
  controlPoints: [
    { model: { x: 100, y: 60, z: 200 }, map: { longitude: 123, latitude: 41 } },
    {
      model: { x: 220, y: 60, z: 200 },
      map: { longitude: 123.00123520138344, latitude: 41.00054027150777 },
    },
    {
      model: { x: 100, y: 60, z: 110 },
      map: { longitude: 122.99946514080546, latitude: 41.000701840622 },
    },
  ],
})
const rawBounds = new Box3(new Vector3(0, -1000, 0), new Vector3(300, 60, 300))
const offset = new Vector3(-150, 470, -150)
const plan = createImageryPlan(rawBounds, placement, offset)

test('瓦片行列、URL 与 UV 北向一致，地图正确转换回模型展示空间', () => {
  assert.deepEqual(tileCoordinate(0, 0, 1), { x: 1, y: 1 })
  const coord = tileCoordinate(123, 41, 16)
  const inverse = tileGeographic(coord.x, coord.y, 16)
  assert.ok(Math.abs(inverse.longitude - 123) < 1e-9)
  assert.ok(Math.abs(inverse.latitude - 41) < 1e-9)
  assert.ok(tileCoordinate(123, 42, 16).y < coord.y)
  assert.ok(plan.project(123, 41).distanceTo(new Vector3(100, 60, 200).add(offset)) < 1e-5)
  assert.ok(plan.tiles.length > 0 && plan.tiles.length <= 256)
  const url = new URL(tileUrl(plan.tiles[0], 'test key'))
  assert.equal(url.protocol, 'https:')
  assert.equal(url.searchParams.get('TILEMATRIXSET'), 'w')
  assert.equal(url.searchParams.get('tk'), 'test key')
  const tile = plan.tiles[0],
    geometry = createTileGeometry(tile, plan.project)
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv')
  const northWest = tileGeographic(tile.x, tile.y, tile.zoom)
  const expected = plan.project(northWest.longitude, northWest.latitude)
  assert.equal(uv.getX(0), 0)
  assert.equal(uv.getY(0), 1)
  assert.ok(new Vector3().fromBufferAttribute(position, 0).distanceTo(expected) < 0.01)
  geometry.dispose()
  const large = createImageryPlan(
    new Box3(new Vector3(-20000, -1000, -20000), new Vector3(20000, 60, 20000)),
    placement,
    offset,
  )
  assert.ok(large.tiles.length <= 256)
  assert.ok(large.tiles[0].zoom < 16)
})

test('影像并发上限、部分失败、翻转、透明度复用与资源销毁', async (t) => {
  let active = 0,
    maxActive = 0,
    calls = 0,
    closed = 0
  const count = 8,
    states = []
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    active++
    maxActive = Math.max(maxActive, active)
    const call = calls
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    return call === 1
      ? new Response('denied', { status: 403 })
      : new Response('image', { headers: { 'content-type': 'image/jpeg' } })
  })
  mockBitmap(t, async (_, options) => {
    assert.equal(options.imageOrientation, 'flipY')
    return {
      width: 256,
      height: 256,
      close() {
        closed++
      },
    }
  })
  let complete
  const done = new Promise((resolve) => {
    complete = resolve
  })
  const layer = createImageryLayer(
    { ...plan, tiles: Array(count).fill(plan.tiles[0]) },
    'test',
    0.65,
    (state) => {
      states.push(state)
      if (state.status !== 'loading') complete()
    },
    () => {},
  )
  await done
  assert.equal(states.at(-1).status, 'partial')
  assert.equal(states.at(-1).loaded, 7)
  assert.equal(states.at(-1).failed, 1)
  assert.equal(maxActive, 6)
  assert.equal(layer.root.children.length, 7)
  layer.setOpacity(0.3)
  assert.equal(calls, count)
  assert.equal(layer.root.children[0].material.opacity, 0.3)
  assert.equal(layer.root.children[0].material.map.flipY, false)
  let released = 0
  layer.root.children[0].geometry.addEventListener('dispose', () => released++)
  layer.root.children[0].material.map.addEventListener('dispose', () => released++)
  layer.root.children[0].material.addEventListener('dispose', () => released++)
  layer.dispose()
  layer.dispose()
  assert.equal(released, 3)
  assert.equal(closed, 7)
  assert.equal(layer.root.children.length, 0)
})

test('关闭时取消请求，不再调度；迟到解码结果释放且不再通知宿主', async (t) => {
  let aborted = 0,
    calls = 0,
    closed = 0,
    finishDecode
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    calls++
    signal.addEventListener('abort', () => aborted++)
    return new Response('image', { headers: { 'content-type': 'image/jpeg' } })
  })
  mockBitmap(
    t,
    () =>
      new Promise((resolve) => {
        finishDecode = () =>
          resolve({
            close() {
              closed++
            },
          })
      }),
  )
  const states = []
  const layer = createImageryLayer(
    { ...plan, tiles: [plan.tiles[0]] },
    'test',
    1,
    (state) => states.push(state),
    () => {},
  )
  while (!finishDecode) await new Promise((resolve) => setTimeout(resolve, 1))
  layer.dispose()
  finishDecode()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(aborted, 1)
  assert.equal(calls, 1)
  assert.equal(closed, 1)
  assert.deepEqual(
    states.map((s) => s.status),
    ['loading'],
  )
  assert.equal(layer.root.children.length, 0)
})

test('无效 Key 的非图片响应报告错误，错误消息不包含 Key 或请求 URL', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<error>invalid key</error>', { headers: { 'content-type': 'text/xml' } }),
  )
  let complete
  const done = new Promise((resolve) => {
    complete = resolve
  })
  const layer = createImageryLayer(
    { ...plan, tiles: [plan.tiles[0]] },
    'private-test-key',
    1,
    (state) => {
      if (state.status === 'error') complete(state)
    },
    () => {},
  )
  const state = await done
  assert.equal(state.failed, 1)
  assert.match(state.message, /Key/)
  assert.ok(!state.message.includes('private-test-key'))
  layer.dispose()
})
