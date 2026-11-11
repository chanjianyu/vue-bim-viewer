/** 缩放只计算视距并复用统一动画；每个 Viewer 独立保存连续点击的目标。 */
export function createCameraZoom(camera, controls, motion, zoomLimit) {
  let pending
  let disposed = false

  function clearPending() {
    pending = undefined
  }

  function zoom(inward, options = {}) {
    if (disposed || !options || typeof options !== 'object' || Array.isArray(options)) return false
    const factor = options.factor === undefined ? 1.2 : options.factor
    const duration = options.duration === undefined ? 300 : options.duration
    if (!Number.isFinite(factor) || factor <= 1 || !Number.isFinite(duration) || duration < 0)
      return false

    const target = controls.target.clone()
    const offset = camera.position.clone().sub(target)
    const currentDistance = offset.length()
    const base = pending?.distance ?? currentDistance
    const minDistance = controls.minDistance
    const maxDistance = controls.maxDistance
    const userMaxDistance = inward ? Infinity : zoomLimit?.getMaxDistance(target)
    const maximum = Math.min(maxDistance, userMaxDistance ?? Infinity)
    const minimum = Math.max(minDistance, camera.near * 1.001)
    if (
      ![currentDistance, base, minDistance, minimum, camera.near, camera.far].every(
        Number.isFinite,
      ) ||
      currentDistance <= 0 ||
      base <= 0 ||
      minDistance < 0 ||
      camera.near <= 0 ||
      camera.far <= camera.near ||
      !(maximum >= minimum)
    )
      return false

    const boundaryTolerance =
      Number.EPSILON * Math.max(currentDistance, base, ...target.toArray().map(Math.abs)) * 8
    // 交替调用按累计目标判断边界；没有累计目标的超远视角不会被 zoomOut 拉回。
    if (!inward && base >= maximum - boundaryTolerance) return false

    const distance = Math.max(minimum, Math.min(maximum, inward ? base / factor : base * factor))
    // 大坐标下 position-target 的精度受坐标量级影响，边界判断不能只按视距计算误差。
    const tolerance =
      Number.EPSILON *
      Math.max(
        distance,
        base,
        ...target.toArray().map(Math.abs),
        ...camera.position.toArray().map(Math.abs),
      ) *
      8
    if (!Number.isFinite(distance) || Math.abs(distance - base) <= tolerance) return false
    const position = target.clone().addScaledVector(offset.divideScalar(currentDistance), distance)
    // 保留原远裁剪平面覆盖的深度；向内移动时同步收回，避免往返缩放持续扩大 far。
    const far = Math.max(distance * 2, camera.far + (distance - currentDistance), camera.near * 2)
    if (
      ![
        ...target.toArray(),
        ...position.toArray(),
        far,
        far + camera.position.distanceTo(position),
      ].every(Number.isFinite) ||
      position.distanceTo(target) <= camera.near
    )
      return false

    const previous = pending
    const operation = { distance }
    // moveTo 会同步取消旧动画，也可能同步完成；旧回调不能清除新操作。
    pending = operation
    const finish = () => {
      if (pending === operation) clearPending()
    }
    const accepted = motion.moveTo(
      { position, target, near: camera.near, far, minDistance, maxDistance },
      { duration },
      { onComplete: finish, onCancel: finish },
    )
    if (!accepted) pending = previous
    return accepted
  }

  return {
    zoomIn: (options) => zoom(true, options),
    zoomOut: (options) => zoom(false, options),
    clearPending,
    dispose() {
      disposed = true
      clearPending()
    },
  }
}
