import { Box3, Sphere } from 'three'

// 按完整模型包围球的投影估算缩小上限，直径占视口短边 8%。
const MIN_VISIBLE_RATIO = 0.08

/**
 * 管理只对用户滚轮和 zoomOut 生效的模型缩小上限。
 * 程序化相机动画仍由 camera-motion 自己维护控制器边界。
 */
export function createCameraZoomLimit(camera, controls, domElement) {
  let modelSphere
  let width = 0
  let height = 0
  let disposed = false
  let wheelState

  function clearModelBounds() {
    modelSphere = undefined
  }

  function setModelBounds(root) {
    if (!root) {
      clearModelBounds()
      return
    }
    const box = new Box3().setFromObject(root, true)
    console.log(box, 'box')
    const sphere = box.isEmpty() ? null : box.getBoundingSphere(new Sphere())
    modelSphere =
      sphere &&
      Number.isFinite(sphere.radius) &&
      sphere.radius > 0 &&
      sphere.center.toArray().every(Number.isFinite)
        ? sphere
        : undefined
  }

  function updateViewport(nextWidth, nextHeight) {
    width = Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : 0
    height = Number.isFinite(nextHeight) && nextHeight > 0 ? nextHeight : 0
  }

  function getMaxDistance(target = controls.target) {
    if (disposed || !modelSphere || width <= 0 || height <= 0) return Infinity
    if (!target || !target.isVector3 || !target.toArray().every(Number.isFinite)) return Infinity

    const verticalFov = (camera.getEffectiveFOV() * Math.PI) / 180
    const aspect = width / height
    if (
      !Number.isFinite(verticalFov) ||
      verticalFov <= 0 ||
      verticalFov >= Math.PI ||
      !Number.isFinite(aspect) ||
      aspect <= 0
    )
      return Infinity

    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    const shortFov = Math.min(verticalFov, horizontalFov)
    const visibleHalfAngle = Math.atan(MIN_VISIBLE_RATIO * Math.tan(shortFov / 2))
    const centerDistance = modelSphere.radius / Math.sin(visibleHalfAngle)
    const targetOffset = target.distanceTo(modelSphere.center)
    const minimum = Math.max(controls.minDistance, camera.near * 1.001, 0.001)
    const maxDistance = centerDistance - targetOffset
    if (!Number.isFinite(maxDistance) || !Number.isFinite(minimum)) return Infinity
    return Math.max(minimum, maxDistance)
  }

  function getRequiredFar(position = camera.position) {
    if (disposed || !modelSphere) return null
    const margin = Math.max(modelSphere.radius * 0.01, 0.001)
    const far = position.distanceTo(modelSphere.center) + modelSphere.radius + margin
    return Number.isFinite(far) && far > 0 ? far : null
  }

  function restoreWheelState(state) {
    camera.position.copy(state.position)
    controls.target.copy(state.target)
    controls.update()
  }

  function captureWheel(event) {
    if (
      disposed ||
      controls.enabled === false ||
      controls.enableZoom === false ||
      !event ||
      event.deltaY <= 0
    ) {
      wheelState = undefined
      return
    }
    wheelState = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      distance: camera.position.distanceTo(controls.target),
    }
  }

  function clampWheel(event) {
    const state = wheelState
    wheelState = undefined
    if (
      disposed ||
      !state ||
      !modelSphere ||
      !event.defaultPrevented ||
      controls.enabled === false ||
      controls.enableZoom === false
    )
      return

    const maximum = Math.min(getMaxDistance(controls.target), controls.maxDistance)
    const afterDistance = camera.position.distanceTo(controls.target)
    const tolerance = Number.EPSILON * Math.max(state.distance, afterDistance, 1) * 8
    // 被控制器忽略的事件不能接管相机；只夹取这次滚轮实际产生的向外缩放。
    if (
      !Number.isFinite(maximum) ||
      !Number.isFinite(afterDistance) ||
      afterDistance <= state.distance + tolerance ||
      afterDistance <= maximum
    )
      return

    // 程序化视角可以暂时超出用户边界；继续滚轮缩小时保持原位置，避免突然跳回边界。
    if (state.distance > maximum) {
      restoreWheelState(state)
      return
    }

    const offset = camera.position.clone().sub(controls.target)
    if (offset.lengthSq() <= 0) {
      restoreWheelState(state)
      return
    }
    camera.position.copy(controls.target).addScaledVector(offset.normalize(), maximum)
    controls.update()
  }

  domElement?.addEventListener('wheel', captureWheel, { capture: true, passive: true })
  domElement?.addEventListener('wheel', clampWheel, { passive: true })

  return {
    setModelBounds,
    clearModelBounds,
    updateViewport,
    getMaxDistance,
    getRequiredFar,
    clear() {
      wheelState = undefined
    },
    dispose() {
      if (disposed) return
      disposed = true
      wheelState = undefined
      domElement?.removeEventListener('wheel', captureWheel, { capture: true })
      domElement?.removeEventListener('wheel', clampWheel)
      clearModelBounds()
    },
  }
}
