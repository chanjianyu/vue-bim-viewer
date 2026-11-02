import { Color, Mesh } from 'three'
import { flattenComponentTree } from './components.js'
import { isRecord } from './model.js'

const keys = ['visible', 'opacity', 'color']
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
      opacity: 1,
      color: null,
    })
    if (object instanceof Mesh) originalMaterials.set(object, object.material)
  }
  /** 返回可持久化净差异快照，不暴露内部 Map，也不包含选择轮廓。 */
  function changes() {
    return {
      schemaVersion: 1,
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
      // 隐藏沿祖先继承，透明度逐级相乘，颜色取最近覆盖；原材质另作基底。
      const value = {
        visible: (parent?.visible ?? true) && (patch.visible ?? base.visible),
        opacity: (parent?.opacity ?? 1) * (patch.opacity ?? base.opacity),
        color: patch.color ?? parent?.color ?? null,
      }
      effective.set(node.id, value)
      const object = components.renderObjects.get(node.id)
      object.visible = value.visible
      if (!(object instanceof Mesh)) continue
      const original = originalMaterials.get(object)
      if (value.opacity === 1 && value.color === null) {
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
        clone.opacity = material.opacity * value.opacity
        clone.transparent = material.transparent || clone.opacity < 1
        clone.depthWrite = clone.opacity < 1 ? false : material.depthWrite
        if (
          'color' in clone &&
          clone.color instanceof Color &&
          'color' in material &&
          material.color instanceof Color
        ) {
          clone.color.copy(material.color)
          if (value.color) clone.color.set(value.color)
        }
        clone.needsUpdate = true
        return clone
      })
      object.material = Array.isArray(original) ? mapped : mapped[0]
    }
  }
  const meshClones = new Map()
  function validatePatch(value) {
    if (!isRecord(value) || !Object.keys(value).length) return 'patch 必须包含外观字段'
    if (Object.keys(value).some((key) => !keys.includes(key))) return '包含未知外观字段'
    if ('visible' in value && value.visible !== null && typeof value.visible !== 'boolean')
      return 'visible 必须为布尔值或 null'
    if (
      'opacity' in value &&
      value.opacity !== null &&
      (typeof value.opacity !== 'number' ||
        !Number.isFinite(value.opacity) ||
        value.opacity < 0 ||
        value.opacity > 1)
    )
      return 'opacity 必须在 0–1 之间或为 null'
    if (
      'color' in value &&
      value.color !== null &&
      (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color))
    )
      return 'color 必须是 #RRGGBB 或 null'
    return null
  }
  /** 批量更新自身覆盖，集中同步材质并发一次变更事件；无效项单独报告。 */
  function apply(updates, source = 'api') {
    const response = result(),
      before = changes()
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
      const previous = own.get(update.id) || {},
        next = { ...previous },
        base = initial.get(update.id)
      for (const key of keys) {
        if (!(key in update.patch)) continue
        let value = update.patch[key]
        if (key === 'color' && typeof value === 'string') value = value.toLowerCase()
        // 撤销或回到逻辑初值时删除记录，防止历史操作累积为无效差异。
        if (value === null || value === base[key]) delete next[key]
        else Object.assign(next, { [key]: value })
      }
      if (keys.every((key) => previous[key] === next[key])) continue
      if (Object.keys(next).length) own.set(update.id, next)
      else own.delete(update.id)
      response.changedIds.push(update.id)
    }
    response.changedIds = [...new Set(response.changedIds)]
    response.unknownIds = [...new Set(response.unknownIds)]
    if (response.changedIds.length) {
      sync()
      onChange({ source, before, after: changes(), result: response })
    }
    return response
  }
  /** 先校验版本与全部字段，再合并应用；校验失败不能留下半份导入状态。 */
  function importChanges(value) {
    if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.overrides))
      return { ...result(), error: '外观文件格式无效' }
    if (value.modelId !== components.tree.modelId || value.revision !== components.tree.revision)
      return { ...result(), error: '模型身份或版本不匹配，未应用任何修改' }
    const updates = []
    for (const item of value.overrides) {
      if (!isRecord(item) || typeof item.id !== 'string' || validatePatch(item.current))
        return { ...result(), error: '外观文件包含无效修改，未应用任何修改' }
      updates.push({ id: item.id, patch: item.current })
    }
    return apply(updates, 'import')
  }
  function restore(id) {
    const ids = id === undefined ? [...own.keys()] : [id]
    return apply(
      ids.map((id) => ({ id, patch: { visible: null, opacity: null, color: null } })),
      'restore',
    )
  }
  sync()
  return {
    changes,
    apply,
    importChanges,
    restore,
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
