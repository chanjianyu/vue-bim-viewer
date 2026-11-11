import { Box3, Sphere, Vector3 } from 'three'

const MIN_DISTANCE = 1e-9
const UP_PARALLEL_LIMIT = 1 - 1e-6

const finitePoint = (value) =>
  value && [value.x, value.y, value.z].every((component) => Number.isFinite(component))

export function validateViewState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!finitePoint(value.position) || !finitePoint(value.target) || !finitePoint(value.up))
    return null

  const position = new Vector3(value.position.x, value.position.y, value.position.z)
  const target = new Vector3(value.target.x, value.target.y, value.target.z)
  const up = new Vector3(value.up.x, value.up.y, value.up.z)
  const distance = position.distanceTo(target)
  const upLength = up.length()
  if (
    !Number.isFinite(distance) ||
    distance <= MIN_DISTANCE ||
    !Number.isFinite(upLength) ||
    upLength <= MIN_DISTANCE
  )
    return null
  up.normalize()
  const viewDirection = position.clone().sub(target).normalize()
  if (Math.abs(viewDirection.dot(up)) >= UP_PARALLEL_LIMIT) return null
  return { position, target, up }
}

export function getCameraViewState(camera, controls, offset) {
  if (!camera || !controls || !offset) return null
  const position = camera.position.clone().sub(offset)
  const target = controls.target.clone().sub(offset)
  const up = camera.up.clone()
  const value = validateViewState({ position, target, up })
  if (!value) return null
  return {
    position: value.position.toArray().reduce((point, component, index) => {
      point[['x', 'y', 'z'][index]] = component
      return point
    }, {}),
    target: value.target.toArray().reduce((point, component, index) => {
      point[['x', 'y', 'z'][index]] = component
      return point
    }, {}),
    up: value.up.toArray().reduce((point, component, index) => {
      point[['x', 'y', 'z'][index]] = component
      return point
    }, {}),
  }
}

/** 将原模型坐标快照转换为当前展示坐标，并自动重算裁剪面和距离边界。 */
export function createCameraView(camera, controls, model, value) {
  const state = validateViewState(value)
  if (!state || !model?.root || !model?.offset) return null

  const position = state.position.clone().add(model.offset)
  const target = state.target.clone().add(model.offset)
  const distance = position.distanceTo(target)
  const sphere = new Box3().setFromObject(model.root, true).getBoundingSphere(new Sphere())
  const radius = Math.max(sphere.radius, 0.01)
  const near = Math.min(camera.near, distance / 100)
  const far = Math.max(distance * 2, position.distanceTo(sphere.center) + radius, near * 2)
  const minDistance = Math.min(controls.minDistance, distance)
  // OrbitControls 默认 maxDistance 为 Infinity（不限制）；首次展示时控件边界尚未收敛，
  // 直接继承会让快照被当作非法值而回退自动适配。此时按视距或模型半径的 10 倍补上有限上限。
  const maxDistance = Number.isFinite(controls.maxDistance)
    ? Math.max(controls.maxDistance, distance)
    : Math.max(distance, radius) * 10
  if (
    ![
      ...position.toArray(),
      ...target.toArray(),
      ...state.up.toArray(),
      distance,
      near,
      far,
      minDistance,
      maxDistance,
      far + camera.position.distanceTo(position),
    ].every(Number.isFinite) ||
    near <= 0 ||
    far <= near ||
    minDistance < 0 ||
    maxDistance < minDistance
  )
    return null
  return { position, target, up: state.up, near, far, minDistance, maxDistance }
}
