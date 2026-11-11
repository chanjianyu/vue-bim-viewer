/** CSS 像素半径与设备像素比无关；不传配置时保持原有 Marker 行为。 */
export function resolveMarkerClustering(options) {
  return {
    enabled: options?.enabled === true,
    radius: Number.isFinite(options?.radius) && options.radius > 0 ? options.radius : 48,
  }
}

const compareId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 每个 Viewer 持有独立实例；输入仅为投影快照，不保存相机或改写宿主数据。 */
export function createMarkerClustering() {
  let previous = new Map()
  let lastInput, lastRadius, lastExcluded, lastResult
  function clear() {
    previous.clear()
    lastInput = lastResult = undefined
  }
  return {
    clear,
    update(markers, options, excludedId = null) {
      const { enabled, radius } = resolveMarkerClustering(options)
      if (!enabled) {
        clear()
        return { singles: markers.filter((marker) => marker.visible), clusters: [] }
      }
      if (lastInput === markers && lastRadius === radius && lastExcluded === excludedId)
        return lastResult
      if (lastRadius !== radius) previous.clear()
      const visible = markers.filter(
        (marker) => marker.visible && Number.isFinite(marker.x) && Number.isFinite(marker.y),
      )
      const singles = visible.filter((marker) => marker.id === excludedId)
      const available = new Map(
        visible.filter((marker) => marker.id !== excludedId).map((marker) => [marker.id, marker]),
      )
      // 旧代表点优先，ID 决定稳定顺序；加入半径与保留半径不同，避免边界闪烁。
      const ordered = [...available.values()].sort(compareId)
      const seeds = [
        ...ordered.filter((marker) => previous.has(marker.id)),
        ...ordered.filter((marker) => !previous.has(marker.id)),
      ]
      const cellSize = radius * 1.25
      const grid = new Map()
      const keyOf = (x, y) => `${x},${y}`
      for (const marker of ordered) {
        const key = keyOf(Math.floor(marker.x / cellSize), Math.floor(marker.y / cellSize))
        if (!grid.has(key)) grid.set(key, new Map())
        grid.get(key).set(marker.id, marker)
      }
      const next = new Map()
      const clusters = []
      for (const seed of seeds) {
        if (!available.has(seed.id)) continue
        const members = []
        const oldMembers = previous.get(seed.id)
        const column = Math.floor(seed.x / cellSize),
          row = Math.floor(seed.y / cellSize)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = grid.get(keyOf(column + dx, row + dy))
            if (!cell) continue
            for (const marker of cell.values()) {
              const limit = oldMembers?.has(marker.id) ? cellSize : radius
              // 固定代表点，不递归吸收邻居，避免长链把整个屏幕连接成一组。
              if (Math.hypot(marker.x - seed.x, marker.y - seed.y) > limit) continue
              members.push(marker)
              available.delete(marker.id)
              cell.delete(marker.id)
            }
          }
        }
        if (members.length < 2) {
          singles.push(seed)
          continue
        }
        members.sort(compareId)
        const memberIds = members.map((marker) => marker.id)
        next.set(seed.id, new Set(memberIds))
        // 逐项缩放后求和，平均位置不会因大量同坐标成员而累加溢出。
        clusters.push({
          id: `cluster:${seed.id}`,
          count: members.length,
          memberIds,
          x: members.reduce((sum, marker) => sum + marker.x / members.length, 0),
          y: members.reduce((sum, marker) => sum + marker.y / members.length, 0),
          members,
        })
      }
      previous = next
      lastInput = markers
      lastRadius = radius
      lastExcluded = excludedId
      lastResult = { singles, clusters }
      return lastResult
    },
  }
}
