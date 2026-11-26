import { Vector3 } from 'three'
import { resolveConnectionVisual } from './connection-visual.js'

const removedFields = {
  color: 'visual.core.color',
  width: 'visual.core.width',
  opacity: 'visual.core.opacity',
  showArrows: 'visual.arrows.enabled',
  flow: 'visual.pulse（单圈时长使用 visual.pulse.duration）',
}

export function connectionLineFailure(error, unknownIds = [], invalidAnchorIds = []) {
  return { success: false, error, unknownIds, invalidAnchorIds }
}

/** 先完整解析再创建 GPU 资源；坐标只在这里叠加一次展示偏移。 */
export function resolveConnectionLine(value, components, offset) {
  const fail = (error) => ({ result: connectionLineFailure(error) })
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('连接线配置必须是对象')
  for (const [field, replacement] of Object.entries(removedFields)) {
    if (Object.hasOwn(value, field)) return fail(`${field} 已移除，请使用 ${replacement}`)
  }
  const { id, componentIds } = value
  if (typeof id !== 'string' || !id.trim()) return fail('连接线 id 必须为非空字符串')
  if (
    !Array.isArray(componentIds) ||
    componentIds.length < 2 ||
    Array.from(componentIds).some((item) => typeof item !== 'string' || !item.trim())
  )
    return fail('componentIds 至少需要两个非空构件 ID')
  const options = {
    id,
    componentIds: [...componentIds],
    visible: value.visible === undefined ? true : value.visible,
  }
  if (typeof options.visible !== 'boolean') return fail('visible 必须为布尔值')
  const visual = resolveConnectionVisual(value.visual)
  if (visual.error) return fail(visual.error)
  options.visual = visual.options
  if (!offset?.isVector3 || !offset.toArray().every(Number.isFinite))
    return fail('模型展示偏移无效')

  const unknown = new Set(),
    invalid = new Set(),
    points = []
  for (const componentId of options.componentIds) {
    const node = components.byId.get(componentId)
    if (!node) {
      unknown.add(componentId)
      continue
    }
    const anchor = components.getAnchor(componentId, node.hasGeometry ? 'center' : 'origin')
    if (!anchor || ![anchor.x, anchor.y, anchor.z].every(Number.isFinite)) {
      invalid.add(componentId)
      continue
    }
    const point = new Vector3(anchor.x, anchor.y, anchor.z).add(offset)
    // GPU 顶点采用 Float32；拒绝溢出，并按实际可绘制精度过滤连续重合点。
    const values = point.toArray().map(Math.fround)
    if (!values.every(Number.isFinite)) {
      invalid.add(componentId)
      continue
    }
    point.fromArray(values)
    if (!points.length || !points[points.length - 1].equals(point)) points.push(point)
  }
  if (unknown.size || invalid.size)
    return {
      result: connectionLineFailure(
        '存在未知构件或无效锚点，连接线未更新',
        [...unknown],
        [...invalid],
      ),
    }
  if (points.length < 2) return fail('连接线至少需要两个不同位置，当前路径全部重合')
  const lengths = [],
    cumulativeLengths = [0]
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    const length = points[i - 1].distanceTo(points[i])
    const nextLength = totalLength + length
    if (!Number.isFinite(nextLength) || length <= 0 || nextLength <= totalLength)
      return fail('连接线路径长度无效')
    lengths.push(length)
    cumulativeLengths.push(nextLength)
    totalLength = nextLength
  }
  return { options, points, path: { lengths, cumulativeLengths, totalLength } }
}
