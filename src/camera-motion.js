import { Box3, Sphere, Spherical, Vector3 } from 'three'

/** 原模型坐标转为展示目标；所有计算先完成，失败时不影响当前动画。 */
export function createPointView(camera, controls, model, point, options = {}) {
  if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return null
  const duration = options.duration === undefined ? 800 : options.duration
  const direction = camera.position.clone().sub(controls.target)
  const currentDistance = direction.length()
  const distance = options.distance === undefined ? currentDistance : options.distance
  if (
    !Number.isFinite(duration) ||
    duration < 0 ||
    !Number.isFinite(currentDistance) ||
    currentDistance <= 0 ||
    !Number.isFinite(distance) ||
    distance <= 0
  )
    return null
  const target = new Vector3(point.x, point.y, point.z).add(model.offset)
  const position = target.clone().addScaledVector(direction.divideScalar(currentDistance), distance)
  const sphere = new Box3().setFromObject(model.root, true).getBoundingSphere(new Sphere())
  const near = Math.min(camera.near, distance / 100)
  const far = Math.max(camera.far, distance * 2, position.distanceTo(sphere.center) + sphere.radius)
  const minDistance = Math.min(controls.minDistance, distance)
  const maxDistance = Math.max(controls.maxDistance, distance)
  const actualDistance = position.distanceTo(target)
  // 同时验证动画中间值，防止极端数值溢出或精度不足导致相机与目标重合。
  if (
    ![
      ...target.toArray(),
      ...position.toArray(),
      near,
      far,
      minDistance,
      maxDistance,
      actualDistance,
      far + camera.position.distanceTo(position),
      controls.target.distanceTo(target),
    ].every(Number.isFinite) ||
    near <= 0 ||
    far <= near ||
    actualDistance <= near ||
    minDistance < 0 ||
    maxDistance < minDistance
  )
    return null
  return { position, target, near, far, minDistance, maxDistance }
}

/** 只修改相机；帧调度、模型和输入事件仍由 Viewer 管理。 */
export function createCameraMotion(camera, controls) {
  let flight

  function applyLimits(view) {
    camera.near = view.near
    camera.far = view.far
    controls.minDistance = view.minDistance
    controls.maxDistance = view.maxDistance
    camera.updateProjectionMatrix()
  }

  function cancel() {
    if (!flight) return
    // 中途接管时保留当前姿态，缩放范围仍须容纳当前相机距离。
    const distance = camera.position.distanceTo(controls.target)
    controls.minDistance = Math.min(flight.view.minDistance, distance)
    controls.maxDistance = Math.max(flight.view.maxDistance, distance)
    flight = undefined
  }

  return {
    cancel,
    moveTo(view, options = {}) {
      const duration = options.duration ?? 800
      if (!Number.isFinite(duration) || duration < 0) return false
      cancel()
      const from = camera.position.clone(),
        target = controls.target.clone()
      // 清除拖动阻尼残量后恢复当前姿态，避免旧惯性干扰新的过渡。
      const damping = controls.enableDamping
      controls.enableDamping = false
      controls.update()
      camera.position.copy(from)
      controls.target.copy(target)
      // 过渡途中也必须容纳起点距离，不能先被小构件的缩放上限夹到终点附近。
      controls.minDistance = Math.min(controls.minDistance, view.minDistance)
      controls.maxDistance = Math.max(
        controls.maxDistance,
        view.maxDistance,
        from.distanceTo(target),
      )
      camera.near = Math.min(camera.near, view.near)
      camera.far = Math.max(camera.far, view.far + from.distanceTo(view.position))
      camera.updateProjectionMatrix()
      controls.update()
      controls.enableDamping = damping
      if (duration === 0 || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        camera.position.copy(view.position)
        controls.target.copy(view.target)
        applyLimits(view)
        controls.update()
        controls.saveState()
      } else {
        const start = new Spherical().setFromVector3(from.clone().sub(target))
        const end = new Spherical().setFromVector3(view.position.clone().sub(view.target))
        // 方位角取最短路径，转到相反视角时也不会直线穿过观察目标。
        end.theta =
          start.theta +
          Math.atan2(Math.sin(end.theta - start.theta), Math.cos(end.theta - start.theta))
        flight = { from: start, to: end, target, view, started: performance.now(), duration }
      }
      return true
    },
    /** 返回是否需要继续渲染；使用 RAF 时间戳，不依赖帧率。 */
    update(now) {
      if (!flight) return false
      const t = Math.max(0, Math.min(1, (now - flight.started) / flight.duration))
      const eased = t * t * (3 - 2 * t)
      controls.target.lerpVectors(flight.target, flight.view.target, eased)
      const { from, to } = flight
      const offset = new Spherical(
        from.radius + (to.radius - from.radius) * eased,
        from.phi + (to.phi - from.phi) * eased,
        from.theta + (to.theta - from.theta) * eased,
      )
      camera.position.setFromSpherical(offset).add(controls.target)
      if (t === 1) {
        camera.position.copy(flight.view.position)
        applyLimits(flight.view)
        flight = undefined
        controls.update()
        controls.saveState()
      }
      return Boolean(flight)
    },
  }
}
