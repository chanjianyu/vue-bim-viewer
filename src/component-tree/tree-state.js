import { flattenComponentTree } from '../components.js'

/** 只索引模型快照，不持有 Three 对象或另一份外观状态。 */
export function indexTree(tree) {
  const nodes = flattenComponentTree(tree)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const layout = new Map()
  const place = (siblings, depth) =>
    siblings.forEach((node, position) =>
      layout.set(node.id, { depth, position: position + 1, size: siblings.length }),
    )
  place(tree?.roots || [], 0)
  for (const node of nodes) {
    place(node.children, layout.get(node.id).depth + 1)
  }
  return { nodes, byId, layout, roots: tree?.roots || [] }
}

export function searchTree(index, query) {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return null
  const included = new Set(),
    expanded = new Set()
  // 子先父归并匹配路径，深层目录不递归，也不反复遍历祖先。
  for (let i = index.nodes.length - 1; i >= 0; i--) {
    const node = index.nodes[i]
    if (node.name.toLocaleLowerCase().includes(term)) included.add(node.id)
    if (included.has(node.id) && node.parentId) {
      included.add(node.parentId)
      expanded.add(node.parentId)
    }
  }
  return { included, expanded }
}

export function visibleRows(index, expanded, search) {
  const rows = [],
    stack = [...index.roots].reverse()
  while (stack.length) {
    const node = stack.pop()
    if (search && !search.included.has(node.id)) continue
    const children = node.children.filter((child) => !search || search.included.has(child.id))
    rows.push({ node, ...index.layout.get(node.id), branch: children.length > 0 })
    if (expanded.has(node.id))
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return rows
}

/** 按完整分支的几何体计算三态；搜索、颜色和透明度不参与显隐统计。 */
export function visibilityStates(index, getAppearance) {
  const states = new Map()
  for (let i = index.nodes.length - 1; i >= 0; i--) {
    const node = index.nodes[i]
    let total = node.hasGeometry ? 1 : 0
    let shown = node.hasGeometry && getAppearance(node.id)?.effective.visible ? 1 : 0
    for (const child of node.children) {
      const state = states.get(child.id)
      total += state.total
      shown += state.shown
    }
    states.set(node.id, {
      total,
      shown,
      checked: total > 0 && shown === total,
      mixed: shown > 0 && shown < total,
    })
  }
  return states
}

export function visibilityUpdates(index, id, visible, getAppearance) {
  const node = index.byId.get(id)
  if (!node) return []
  const updates = new Map()
  for (const item of flattenComponentTree({ roots: [node] })) updates.set(item.id, visible)
  if (visible) {
    let child = node
    while (child.parentId) {
      const parent = index.byId.get(child.parentId)
      // 打开祖先前固定其他隐藏分支，避免隐式显示它们。
      for (const sibling of parent.children)
        if (sibling.id !== child.id && !getAppearance(sibling.id)?.effective.visible)
          updates.set(sibling.id, false)
      updates.set(parent.id, true)
      child = parent
    }
  }
  return [...updates].map(([id, visible]) => ({ id, patch: { visible } }))
}
