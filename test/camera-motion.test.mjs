import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createCameraMotion } from '../src/camera-motion.js'

function setup(t) {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const camera = new PerspectiveCamera(42, 1, 0.1, 10000)
  camera.position.set(0, 0, 1000)
  const controls = new OrbitControls(camera)
  controls.enableDamping = true
  controls.maxDistance = 10000
  const motion = createCameraMotion(camera, controls)
  // 未连接 DOM 的 controls 不注册事件，也无需调用要求 DOM 的 dispose。
  return {
    camera,
    controls,
    motion,
    step(time) {
      now = time
      const active = motion.update(time)
      controls.update()
      return active
    },
  }
}

const view = {
  position: new Vector3(100, 0, 10),
  target: new Vector3(100, 0, 0),
  near: 0.001,
  far: 100,
  minDistance: 0.01,
  maxDistance: 100,
}
function near(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${actual.toArray()} 应接近 ${expected.toArray()}`)
}

test('全景到小构件不会首帧跳变，默认 800ms 平滑移动并准确停止', (t) => {
  const { camera, controls, motion, step } = setup(t)
  assert.equal(motion.moveTo(view), true)
  near(camera.position, new Vector3(0, 0, 1000))
  assert.equal(step(0), true)
  near(camera.position, new Vector3(0, 0, 1000))
  assert.ok(controls.maxDistance >= 1000)
  assert.ok(camera.far >= 10000)
  assert.equal(step(200), true)
  near(controls.target, new Vector3(15.625, 0, 0))
  assert.equal(step(400), true)
  near(camera.position, new Vector3(50, 0, 505))
  assert.equal(step(800), false)
  near(camera.position, view.position)
  near(controls.target, view.target)
  assert.equal(camera.near, view.near)
  assert.equal(camera.far, view.far)
  assert.equal(controls.maxDistance, view.maxDistance)
  assert.equal(step(1600), false)
  near(camera.position, view.position)
})

test('连续定位从当前姿态转向新目标，duration: 0 立即替换动画', (t) => {
  const { camera, controls, motion, step } = setup(t)
  motion.moveTo(view, { duration: 1000 })
  step(500)
  const current = camera.position.clone()
  const next = { ...view, position: new Vector3(-100, 20, 30), target: new Vector3(-100, 0, 0) }
  motion.moveTo(next, { duration: 600 })
  near(camera.position, current)
  step(1100)
  near(camera.position, next.position)
  near(controls.target, next.target)
  motion.moveTo(view)
  step(1200)
  motion.moveTo(next, { duration: 0 })
  near(camera.position, next.position)
  assert.equal(step(3000), false)
  near(camera.position, next.position)
})

test('取消后相机不被旧动画覆盖，缩放范围容纳当前位置', (t) => {
  const { camera, controls, motion, step } = setup(t)
  motion.moveTo(view)
  step(200)
  const current = camera.position.clone()
  motion.cancel()
  assert.equal(step(1600), false)
  near(camera.position, current)
  assert.ok(controls.maxDistance >= camera.position.distanceTo(controls.target) - 1e-7)
})

test('重置到相反方向绕目标旋转，过渡中不穿过目标', (t) => {
  const { camera, controls, motion, step } = setup(t)
  motion.moveTo({
    ...view,
    position: new Vector3(0, 0, -1000),
    target: new Vector3(),
    maxDistance: 10000,
  })
  step(400)
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - 1000) < 1e-7)
  step(800)
  near(camera.position, new Vector3(0, 0, -1000))
})

test('非法时长不改变或中断有效动画；减少动态效果时立即定位', (t) => {
  const { camera, motion, step } = setup(t)
  motion.moveTo(view)
  for (const duration of [-1, NaN, Infinity, '800'])
    assert.equal(motion.moveTo(view, { duration }), false)
  assert.equal(step(400), true)
  const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  Object.defineProperty(globalThis, 'matchMedia', {
    value: () => ({ matches: true }),
    configurable: true,
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'matchMedia', original)
    else delete globalThis.matchMedia
  })
  assert.equal(motion.moveTo(view, { duration: 1000 }), true)
  near(camera.position, view.position)
  assert.equal(step(1600), false)
})
