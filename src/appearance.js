import { flattenComponentTree } from './components.js'
import { isRecord } from './model.js'

const keys = ['visible', 'translucent', 'color']
const result = () => ({ changedIds: [], unknownIds: [], skipped: [] })

/** 运行时覆盖状态只有这一份；宿主只能拿到快照，并通过方法提交修改。 */
export function createAppearance(components, onChange = () => {}) {
  const nodes = flattenComponentTree(components.tree)
  const own = new Map()
  const initial = new Map()
  const effective = new Map()
  const originalMaterials = new Map()
  for (const node of nodes) {
    const object = components.renderObjects.get(node.id)
    initial.set(node.id, {
      visible: object.visible && node.metadata.visible !== false,
      translucent: false,
      color: null,
    })
    if (object?.isMesh === true) originalMaterials.set(object, object.material)
  }
  /** 返回可持久化净差异快照，不暴露内部 Map，也不包含临时选择效果。 */
  function changes() {
    return {
      schemaVersion: 2,
      modelId: components.tree.modelId,
      revision: components.tree.revision,
      overrides: [...own].map(([id, patch]) => ({
        id,
        original: Object.fromEntries(
          keys.filter((key) => key in patch).map((key) => [key, initial.get(id)[key]]),
        ),
        current: { ...patch },
      })),
    }
  }
  function sync() {
    // 外观遍历沿用父先子的扁平索引；调用次数与深度无关。
    for (const node of nodes) {
      const base = initial.get(node.id),
        patch = own.get(node.id) || {}
      const parent = node.parentId ? effective.get(node.parentId) : undefined
      // 显隐和颜色沿祖先继承；透明状态只取几何节点自身覆盖。
      const value = {
        visible: (parent?.visible ?? true) && (patch.visible ?? base.visible),
        translucent: patch.translucent === true,
        color: patch.color ?? parent?.color ?? null,
      }
      effective.set(node.id, value)
      const object = components.renderObjects.get(node.id)
      object.visible = value.visible
      if (object?.isMesh !== true) continue
      const original = originalMaterials.get(object)
      if (!value.translucent && value.color === null) {
        object.material = original
        continue
      }
      const mapped = (Array.isArray(original) ? original : [original]).map((material) => {
        // 每网格独立克隆：同一源材质不能让不同构件的修改互相污染。
        const key = `${node.id}:${material.uuid}`
        let clone = meshClones.get(key)
        if (!clone) {
          clone = material.clone()
          meshClones.set(key, clone)
        }
        clone.opacity = material.opacity * (value.translucent ? 0.5 : 1)
        clone.transparent = material.transparent || clone.opacity < 1
        clone.depthWrite = clone.opacity < 1 ? false : material.depthWrite
        if (
          'color' in clone &&
          clone.color?.isColor === true &&
          'color' in material &&
          material.color?.isColor === true
        ) {
          clone.color.copy(material.color)
          if (value.color) clone.color.set(value.color)
        }
        clone.needsUpdate = true
        return clone
      })
      object.material = Array.isArray(original) ? mapped : mapped[0]
    }
    // 材质已按自身状态更新，再计算对外的完整分支汇总，不能用汇总值渲染父网格。
    const totals = new Map()
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      let total = node.hasGeometry ? 1 : 0,
        translucent = node.hasGeometry && own.get(node.id)?.translucent === true ? 1 : 0
      for (const child of node.children) {
        const count = totals.get(child.id)
        total += count.total
        translucent += count.translucent
      }
      totals.set(node.id, { total, translucent })
      effective.get(node.id).translucent = total > 0 && total === translucent
    }
  }
  const meshClones = new Map()
  function validatePatch(value) {
    if (!isRecord(value) || !Object.keys(value).length) return 'patch 必须包含外观字段'
    if (Object.keys(value).some((key) => !keys.includes(key))) return '包含未知外观字段'
    if ('visible' in value && value.visible !== null && typeof value.visible !== 'boolean')
      return 'visible 必须为布尔值或 null'
    if (
      'translucent' in value &&
      value.translucent !== null &&
      typeof value.translucent !== 'boolean'
    )
      return 'translucent 必须为布尔值或 null'
    if (
      'color' in value &&
      value.color !== null &&
      (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color))
    )
      return 'color 必须是 #RRGGBB 或 null'
    return null
  }
  /** 公共操作展开透明分支；导入使用精确节点覆盖。批末只报告净变化。 */
  function apply(updates, source = 'api', expandTranslucent = true) {
    const response = result(),
      before = changes(),
      previousOwn = new Map(own)
    if (!Array.isArray(updates)) return { ...response, error: 'updates 必须是数组' }
    for (const update of updates) {
      if (!isRecord(update) || typeof update.id !== 'string') {
        response.skipped.push({ id: '', reason: '修改项必须包含构件 ID' })
        continue
      }
      if (!components.byId.has(update.id)) {
        response.unknownIds.push(update.id)
        continue
      }
      const invalid = validatePatch(update.patch)
      if (invalid) {
        response.skipped.push({ id: update.id, reason: invalid })
        continue
      }
      const targets =
        expandTranslucent && 'translucent' in update.patch
          ? flattenComponentTree({ roots: [components.byId.get(update.id)] })
          : [components.byId.get(update.id)]
      for (const node of targets) {
        const patch =
          node.id === update.id ? update.patch : { translucent: update.patch.translucent }
        const previous = own.get(node.id) || {},
          next = { ...previous },
          base = initial.get(node.id)
        for (const key of keys) {
          if (!(key in patch) || (key === 'translucent' && !node.hasGeometry)) continue
          let value = patch[key]
          if (key === 'color' && typeof value === 'string') value = value.toLowerCase()
          // 撤销或回到逻辑初值时删除记录，防止历史操作累积为无效差异。
          if (value === null || value === base[key]) delete next[key]
          else Object.assign(next, { [key]: value })
        }
        if (keys.every((key) => previous[key] === next[key])) continue
        if (Object.keys(next).length) own.set(node.id, next)
        else own.delete(node.id)
      }
    }
    response.changedIds = [...new Set([...previousOwn.keys(), ...own.keys()])].filter((id) =>
      keys.some((key) => previousOwn.get(id)?.[key] !== own.get(id)?.[key]),
    )
    response.unknownIds = [...new Set(response.unknownIds)]
    if (response.changedIds.length) {
      sync()
      onChange({ source, before, after: changes(), result: response })
    }
    return response
  }
  /** 先校验版本与全部字段，再合并应用；校验失败不能留下半份导入状态。 */
  function importChanges(value) {
    if (
      isRecord(value) &&
      (value.schemaVersion === 1 ||
        (Array.isArray(value.overrides) &&
          value.overrides.some((item) =>
            [item?.original, item?.current].some(
              (patch) => isRecord(patch) && typeof patch.opacity === 'number',
            ),
          )))
    )
      return result()
    if (!isRecord(value) || value.schemaVersion !== 2 || !Array.isArray(value.overrides))
      return { ...result(), error: '外观文件格式无效' }
    if (value.modelId !== components.tree.modelId || value.revision !== components.tree.revision)
      return { ...result(), error: '模型身份或版本不匹配，未应用任何修改' }
    const updates = []
    for (const item of value.overrides) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        validatePatch(item.current) ||
        (item.original !== undefined && validatePatch(item.original))
      )
        return { ...result(), error: '外观文件包含无效修改，未应用任何修改' }
      if (!expandablePatch(item))
        return { ...result(), error: '分组节点不能保存自身透明状态，未应用任何修改' }
      updates.push({ id: item.id, patch: item.current })
    }
    return apply(updates, 'import', false)
  }
  function expandablePatch(item) {
    const node = components.byId.get(item.id)
    return !node || node.hasGeometry || !('translucent' in item.current)
  }
  function restore(id) {
    if (typeof id !== 'string' || !id.trim())
      return { ...result(), error: 'restoreComponent 需要传入当前模型中的有效构件 ID' }
    if (!components.byId.has(id)) return { ...result(), unknownIds: [id] }
    return apply([{ id, patch: { visible: null, translucent: null, color: null } }], 'restore')
  }
  function restoreAll() {
    return apply(
      [...own.keys()].map((id) => ({
        id,
        patch: { visible: null, translucent: null, color: null },
      })),
      'restore',
      false,
    )
  }
  sync()
  return {
    changes,
    apply,
    importChanges,
    restore,
    restoreAll,
    get(id) {
      const base = initial.get(id),
        value = effective.get(id)
      return base && value
        ? { own: { ...own.get(id) }, initial: { ...base }, effective: { ...value } }
        : null
    },
    dispose() {
      // 先挂回源材质，再释放本模块克隆；源几何/材质/纹理由模型模块统一释放。
      originalMaterials.forEach((material, mesh) => {
        mesh.material = material
        mesh.visible = true
      })
      nodes.forEach((node) => {
        components.renderObjects.get(node.id).visible = initial.get(node.id).visible
      })
      meshClones.forEach((material) => material.dispose())
      meshClones.clear()
      own.clear()
      effective.clear()
    },
  }
}
