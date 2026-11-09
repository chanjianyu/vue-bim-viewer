import { Vector3 } from 'three'
import { point3 } from './components.js'

/** 真实渲染和聚合拉近预测共用投影，包含 CSS 偏移与相机前后/裁剪检查。 */
export function projectMarkerPosition(modelPosition, screenOffset, offset, camera, width, height) {
  const world = new Vector3(modelPosition.x, modelPosition.y, modelPosition.z).add(offset)
  const projected = world.clone().project(camera)
  const inFront = world.clone().applyMatrix4(camera.matrixWorldInverse).z < 0
  const x = ((projected.x + 1) / 2) * width + (screenOffset?.x || 0)
  const y = ((1 - projected.y) / 2) * height + (screenOffset?.y || 0)
  const visible =
    inFront && Math.abs(projected.z) <= 1 && x >= 0 && x <= width && y >= 0 && y <= height
  return { x, y, visible }
}

/** 在原模型空间解析，再加展示偏移；构件隐藏策略沿用外观的 effective 值。 */
export function projectMarkers(values, components, appearance, offset, camera, width, height) {
  const markers = [],
    issues = [],
    ids = new Set()
  for (const marker of values) {
    try {
      if (!marker.id || ids.has(marker.id)) throw new Error('Marker ID 缺失或重复')
      ids.add(marker.id)
      const position = marker.position
      let modelPosition
      if (position.type === 'model') modelPosition = { x: position.x, y: position.y, z: position.z }
      else if (position.type === 'component') {
        if (appearance.get(position.componentId)?.effective.visible === false) continue
        modelPosition = components.getAnchor(position.componentId, position.anchor || 'origin')
        if (!modelPosition) throw new Error('构件或锚点不存在')
        const delta = position.offset || { x: 0, y: 0, z: 0 }
        modelPosition = {
          x: modelPosition.x + delta.x,
          y: modelPosition.y + delta.y,
          z: modelPosition.z + delta.z,
        }
      } else throw new Error('不支持的定位类型')
      if (!Object.values(modelPosition).every(Number.isFinite))
        throw new Error('模型坐标必须是有限数值')
      if (
        marker.screenOffset &&
        ![marker.screenOffset.x, marker.screenOffset.y].every(Number.isFinite)
      )
        throw new Error('屏幕偏移必须是有限数值')
      // 模型坐标加展示偏移后才投影；投影结果仅供 DOM 布局，不回写 markers 数据。
      // 剔除相机背面、裁剪面和视口外标签；本模块不做几何遮挡检测。
      const projected = projectMarkerPosition(
        modelPosition,
        marker.screenOffset,
        offset,
        camera,
        width,
        height,
      )
      markers.push({
        ...marker,
        modelPosition: point3(new Vector3(modelPosition.x, modelPosition.y, modelPosition.z)),
        ...projected,
      })
    } catch (error) {
      issues.push(
        `标记 ${marker?.id || 'unknown'}：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { markers, issues, width, height }
}
