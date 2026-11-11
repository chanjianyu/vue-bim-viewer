import { Box3, Vector3 } from 'three'
import { isRecord } from './model.js'

export const point3 = (v) => ({ x: v.x, y: v.y, z: v.z })
/** 按源顺序做深度优先展开；显式栈兼容多根与深层 children，null 返回空数组。 */
export function flattenComponentTree(tree) {
  const result = [],
    stack = [...(tree?.roots || [])].reverse()
  while (stack.length) {
    const node = stack.pop()
    result.push(node)
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
  }
  return result
}

/** 逐层复制，避免 JSON/structuredClone 对深层 children 的调用栈限制。 */
export function cloneComponentTree(tree) {
  const copies = new Map()
  const nodes = flattenComponentTree(tree)
  for (const node of nodes)
    copies.set(node, {
      ...node,
      bounds: node.bounds ? structuredClone(node.bounds) : null,
      metadata: structuredClone(node.metadata),
      children: [],
    })
  for (const node of nodes)
    copies.get(node).children = node.children.map((child) => copies.get(child))
  return { ...tree, roots: tree.roots.map((node) => copies.get(node)) }
}

export function cloneComponent(node) {
  return cloneComponentTree({ schemaVersion: 1, modelId: '', revision: '', roots: [node] }).roots[0]
}

/** 两轮索引和连接，保留所有节点与原始 children 顺序，不过滤空节点。 */
export function createComponents(roots, options) {
  const offset = options.offset || new Vector3()
  const warnings = []
  const objects = [],
    stack = [...roots].reverse()
  while (stack.length) {
    const object = stack.pop()
    objects.push(object)
    for (let i = object.children.length - 1; i >= 0; i--) stack.push(object.children[i])
  }
  const hierarchyByName = new Map()
  const hierarchyById = new Map()
  const hierarchyStack = [...(options.metadata?.hierarchy || [])].reverse()
  while (hierarchyStack.length) {
    const node = hierarchyStack.pop()
    if (node.name) hierarchyByName.set(node.name, [...(hierarchyByName.get(node.name) || []), node])
    const id = node.componentId ?? node.uuid
    if (id !== undefined)
      hierarchyById.set(String(id), [...(hierarchyById.get(String(id)) || []), node])
    hierarchyStack.push(...(node.children || []).slice().reverse())
  }
  const originalName = (object) => {
    // Loader 可能清洗名称或为重名加后缀；用源节点索引还原名称后再关联属性。
    const index = options.associations?.get(object)?.nodes
    return index === undefined ? object.name : options.sourceNames?.[index] || object.name
  }
  const nameCounts = new Map()
  objects.forEach((object) =>
    nameCounts.set(originalName(object), (nameCounts.get(originalName(object)) || 0) + 1),
  )
  const byId = new Map(),
    byObject = new Map()
  const renderObjects = new Map()
  const boundsByObject = new Map()
  // 自底向上合并包围盒，避免对每个节点反复遍历整个子树。
  for (let i = objects.length - 1; i >= 0; i--) {
    const object = objects[i],
      box = new Box3()
    if (object?.isInstancedMesh === true) {
      object.computeBoundingBox()
      if (object.boundingBox) box.copy(object.boundingBox).applyMatrix4(object.matrixWorld)
    } else if (object?.isMesh === true) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      if (object.geometry.boundingBox)
        box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld)
    }
    object.children.forEach((child) => {
      const childBox = boundsByObject.get(child)
      if (childBox) box.union(childBox)
    })
    boundsByObject.set(object, box)
  }
  for (const [index, object] of objects.entries()) {
    const name = originalName(object)
    const candidates = hierarchyByName.get(name) || []
    const explicitId = ['componentId', 'externalId', 'elementId', 'uuid']
      .map((key) => object.userData[key])
      .find(
        (value) =>
          (typeof value === 'string' && value.trim().length > 0) ||
          (typeof value === 'number' && Number.isFinite(value)),
      )
    // 显式 ID 优先；旧 hierarchy 仅在两边名称均唯一时补充映射，避免误绑同名构件。
    const idCandidates = explicitId === undefined ? [] : hierarchyById.get(String(explicitId)) || []
    const metadataNode =
      idCandidates.length === 1
        ? idCandidates[0]
        : candidates.length === 1 && nameCounts.get(name) === 1
          ? candidates[0]
          : undefined
    if (candidates.length && !metadataNode && explicitId === undefined)
      warnings.push(`名称重复，未按名称映射：${name}`)
    const sourceIndex = options.associations?.get(object)?.nodes
    // 回退 ID 只保证资源版本内稳定，重新导出后不能直接套用旧外观记录。
    const fallback = `${options.revision}:node:${sourceIndex ?? `scene-${index}`}`
    let id = String(explicitId ?? metadataNode?.componentId ?? metadataNode?.uuid ?? fallback)
    if (byId.has(id)) {
      warnings.push(`构件 ID 重复 ${id}，当前节点改用版本内 ID`)
      id = fallback
      let suffix = 1
      while (byId.has(id)) id = `${fallback}:${suffix++}`
    }
    // extras/旧 properties 仅复制普通元数据，不持久化 Object3D 或 Three UUID。
    const properties = nameCounts.get(name) === 1 ? options.metadata?.properties[name] : undefined
    const box = boundsByObject.get(object)
    const bounds = box.isEmpty()
      ? null
      : {
          min: point3(box.min.clone().sub(offset)),
          max: point3(box.max.clone().sub(offset)),
          center: point3(box.getCenter(new Vector3()).sub(offset)),
        }
    const node = {
      id,
      name: name || object.type,
      type: object.type,
      parentId: null,
      children: [],
      hasGeometry: object?.isMesh === true,
      bounds,
      metadata: {
        ...structuredClone(object.userData),
        ...(isRecord(properties) ? structuredClone(properties) : {}),
        ...(metadataNode
          ? {
              sourceHierarchy: {
                name: metadataNode.name,
                uuid: metadataNode.uuid,
                componentId: metadataNode.componentId,
              },
            }
          : {}),
        sourceNodeIndex: sourceIndex ?? null,
      },
    }
    byId.set(id, node)
    byObject.set(object, id)
    renderObjects.set(id, object)
  }
  // 第二轮只连接已索引的节点；树的层级来自场景 children，而非元数据另造的目录。
  for (const object of objects) {
    const node = byId.get(byObject.get(object))
    const parentId = object.parent && byObject.get(object.parent)
    if (parentId) {
      node.parentId = parentId
      byId.get(parentId).children.push(node)
    }
  }
  const tree = {
    schemaVersion: 1,
    modelId: options.modelId,
    revision: options.revision,
    roots: roots.map((object) => byId.get(byObject.get(object))),
  }
  const getAnchor = (id, anchor = 'origin') => {
    // matrixWorld 已包含展示居中偏移；减去 offset 才能作为可保存的原模型坐标。
    const object = renderObjects.get(id),
      node = byId.get(id)
    if (!object || !node) return null
    if (anchor === 'origin') return point3(object.getWorldPosition(new Vector3()).sub(offset))
    if (!node.bounds || !['center', 'bounds-top'].includes(anchor)) return null
    return {
      ...node.bounds.center,
      y: anchor === 'bounds-top' ? node.bounds.max.y : node.bounds.center.y,
    }
  }
  return { tree, byId, byObject, renderObjects, warnings, getAnchor }
}

/** 原始场景快照保留同源节点结构及关联 ID，去掉业务属性，返回普通数据。 */
export function sceneTree(components) {
  const snapshot = cloneComponentTree(components.tree)
  for (const node of flattenComponentTree(snapshot))
    node.metadata = { sourceNodeIndex: node.metadata.sourceNodeIndex }
  return snapshot
}
