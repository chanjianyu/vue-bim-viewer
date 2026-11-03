import { BufferGeometry, Float32BufferAttribute } from 'three'
import { tileGeographic } from './projection.js'

/** 33x33 地表 + 独立裙边；UV v=1 为北，裙边不改变任何地表顶点。 */
export function createTerrainGeometry(tile, plan, heights, absolute) {
  const positions = [],
    uvs = [],
    indices = [],
    points = []
  for (let row = 0; row <= 32; row++)
    for (let col = 0; col <= 32; col++) {
      const p = tileGeographic(tile.x + col / 32, tile.y + row / 32, tile.zoom)
      points.push(p)
      const point = plan.project(p.longitude, p.latitude, heights[row * 33 + col], absolute)
      positions.push(point.x, point.y, point.z)
      uvs.push(col / 32, 1 - row / 32)
      if (row < 32 && col < 32) {
        const i = row * 33 + col
        indices.push(i, i + 33, i + 1, i + 1, i + 33, i + 34)
      }
    }
  const edges = [
    Array.from({ length: 33 }, (_, i) => i),
    Array.from({ length: 33 }, (_, i) => i * 33 + 32),
    Array.from({ length: 33 }, (_, i) => 32 * 33 + 32 - i),
    Array.from({ length: 33 }, (_, i) => (32 - i) * 33),
  ]
  const skirts = edges.map((edge) =>
    edge.map((i) => {
      const top = positions.length / 3
      positions.push(...positions.slice(i * 3, i * 3 + 3), ...positions.slice(i * 3, i * 3 + 3))
      uvs.push(...uvs.slice(i * 2, i * 2 + 2), ...uvs.slice(i * 2, i * 2 + 2))
      return top
    }),
  )
  const surfaceIndexCount = indices.length
  for (const edge of skirts)
    for (let i = 0; i < 32; i++) {
      const a = edge[i],
        b = edge[i + 1]
      indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  const result = {
    geometry,
    edges: edges.map((edge) => edge.map((i) => heights[i])),
    neighbors: [],
    updateSkirts(neighbors = {}) {
      Object.assign(result.neighbors, neighbors)
      const attribute = geometry.getAttribute('position')
      edges.forEach((edge, side) => {
        const own = result.edges[side],
          other = result.neighbors[side]?.slice().reverse()
        const depth = Math.max(0, ...own.map((h, i) => Math.abs(h - (other?.[i] ?? 0)))) + 10
        // 透明地表下不能重复绘制无缝内部墙，否则地下观察会出现整片黑色格线。
        // 保留裙边顶点及深度；只有外边界、缺测或不一致边缘参与绘制。
        const joined = other && own.every((h, i) => Math.abs(h - other[i]) < 1e-6)
        const start = surfaceIndexCount + side * 32 * 6
        for (let i = start; i < start + 32 * 6; i++) geometry.index.setX(i, joined ? 0 : indices[i])
        edge.forEach((i, index) => {
          const p = points[i],
            point = plan.project(p.longitude, p.latitude, heights[i] - depth, absolute)
          attribute.setXYZ(skirts[side][index] + 1, point.x, point.y, point.z)
        })
      })
      attribute.needsUpdate = true
      geometry.index.needsUpdate = true
      geometry.computeVertexNormals()
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
    },
  }
  result.updateSkirts()
  return result
}
