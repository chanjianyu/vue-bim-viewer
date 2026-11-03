import { Quaternion, Vector3 } from 'three'

const axes = [
  { negative: 'left', positive: 'right', labels: ['左', '右'] },
  { negative: 'bottom', positive: 'top', labels: ['下', '上'] },
  { negative: 'back', positive: 'front', labels: ['后', '前'] },
]

// 固定的 26 个切角平面：六个八边形主面、十二个边面和八个角面。
const regions = []
for (const x of [-1, 0, 1])
  for (const y of [-1, 0, 1])
    for (const z of [-1, 0, 1]) {
      const direction = [x, y, z]
      const count = direction.filter(Boolean).length
      if (!count) continue
      const normal = new Vector3(x, y, z).normalize()
      const names = direction.flatMap((value, i) =>
        value ? [axes[i][value > 0 ? 'positive' : 'negative']] : [],
      )
      const label = direction
        .flatMap((value, i) => (value ? [axes[i].labels[value > 0 ? 1 : 0]] : []))
        .join('')
      const up =
        Math.abs(y) === 1 && count === 1 ? new Vector3(0, 0, y > 0 ? -1 : 1) : new Vector3(0, 1, 0)
      const right = up.clone().cross(normal).normalize()
      up.copy(normal).cross(right)
      regions.push({
        id: names.join('-'),
        label,
        kind: ['face', 'edge', 'corner'][count - 1],
        direction,
        normal,
        up,
        right,
        distance: [1, 1.9, 2.65][count - 1] / Math.sqrt(count),
      })
    }

// 几何只在模块加载时裁剪一次；相机帧中仅旋转和投影这些顶点。
for (const region of regions) {
  const center = region.normal.clone().multiplyScalar(region.distance)
  let vertices = [
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ].map(([x, y]) => center.clone().addScaledVector(region.right, x).addScaledVector(region.up, y))
  for (const plane of regions) {
    if (plane === region) continue
    const clipped = []
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length]
      const da = plane.normal.dot(a) - plane.distance
      const db = plane.normal.dot(b) - plane.distance
      if (da <= 1e-8) clipped.push(a)
      if ((da < -1e-8 && db > 1e-8) || (da > 1e-8 && db < -1e-8))
        clipped.push(a.clone().lerp(b, da / (da - db)))
    }
    vertices = clipped
  }
  region.vertices = vertices
  region.center = center
}

/** 返回普通数据，调用方无法修改共享几何或方向定义。 */
export function getViewCubeRegions() {
  return regions.map(({ id, label, kind, direction }) => ({
    id,
    label,
    kind,
    direction: [...direction],
  }))
}

export function getViewCubeDirection(id, facesOnly = false) {
  const region = regions.find((item) => item.id === id && (!facesOnly || item.kind === 'face'))
  return region ? new Vector3(...region.direction).normalize() : null
}

/** 正交投影与主相机共用旋转；SVG 不需要第二个 WebGL 上下文。 */
export function projectViewCube(orientation) {
  const values = ['x', 'y', 'z', 'w'].map((key) => orientation?.[key])
  const rotation = new Quaternion()
  if (values.every(Number.isFinite) && values.some((value) => value !== 0))
    rotation.fromArray(values).normalize().invert()
  const scale = 32
  const project = (point) => ({ x: 64 + point.x * scale, y: 76 - point.y * scale })
  return regions
    .flatMap((region) => {
      const normal = region.normal.clone().applyQuaternion(rotation)
      if (normal.z <= 1e-6) return []
      const center = region.center.clone().applyQuaternion(rotation)
      const right = region.right.clone().applyQuaternion(rotation)
      const up = region.up.clone().applyQuaternion(rotation)
      const position = project(center)
      return [
        {
          id: region.id,
          label: region.label,
          kind: region.kind,
          depth: center.z,
          points: region.vertices
            .map((vertex) => {
              const point = project(vertex.clone().applyQuaternion(rotation))
              return `${point.x.toFixed(4)},${point.y.toFixed(4)}`
            })
            .join(' '),
          textTransform: `matrix(${right.x * scale},${-right.y * scale},${-up.x * scale},${up.y * scale},${position.x},${position.y})`,
        },
      ]
    })
    .sort((a, b) => a.depth - b.depth)
}

export function resolveNavigation(options) {
  const home = options?.home !== false,
    cube = options?.cube !== false
  return { home, cube, height: cube ? 150 : home ? 44 : 0 }
}
