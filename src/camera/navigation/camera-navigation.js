import { getViewCubeDirection } from './view-cube.js'

/** 方向切换只改变观察方向，保持平移目标、缩放距离与裁剪范围。 */
export function createCameraNavigation(camera, controls, motion) {
  function move(direction, options, facesOnly) {
    const offset = getViewCubeDirection(direction, facesOnly)
    const distance = camera.position.distanceTo(controls.target)
    if (!offset || !Number.isFinite(distance) || distance <= 0) return false
    // OrbitControls 极点保留微小偏角，俯视和仰视后仍能继续拖动。
    if (Math.abs(offset.y) === 1) offset.z = 1e-6
    offset.normalize().multiplyScalar(distance)
    return motion.moveTo(
      {
        position: controls.target.clone().add(offset),
        target: controls.target.clone(),
        near: camera.near,
        far: camera.far,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      },
      options,
    )
  }
  return {
    setViewDirection: (direction, options) => move(direction, options, true),
    navigate: (direction, options) => move(direction, options, false),
  }
}
