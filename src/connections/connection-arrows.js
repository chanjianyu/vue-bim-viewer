import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  Matrix4,
} from 'three'

/** 经典箭头保留中点；科技箭头按投影长度重复，屏幕变化时才更新几何。 */
export function createConnectionArrows(points, options) {
  const cyber = options.visual.preset === 'cyber'
  const config = options.visual.arrows
  const geometry = new BufferGeometry()
  const material = new ShaderMaterial({
    uniforms: {
      diffuse: { value: new Color(config.color) },
      opacity: { value: options.visual.core.opacity },
      resolution: { value: new Vector2(1, 1) },
    },
    vertexShader: `
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      attribute vec2 corner;
      attribute float fraction;
      uniform vec2 resolution;
      void main() {
        vec4 start = projectionMatrix * modelViewMatrix * vec4(segmentStart, 1.0);
        vec4 end = projectionMatrix * modelViewMatrix * vec4(segmentEnd, 1.0);
        vec2 delta = (end.xy / end.w - start.xy / start.w) * resolution * 0.5;
        vec2 direction = normalize(delta);
        vec2 perpendicular = vec2(-direction.y, direction.x);
        // 屏幕均匀间距转换为空间插值，避免透视远近导致箭头聚集。
        float t = fraction * start.w / mix(end.w, start.w, fraction);
        gl_Position = mix(start, end, t);
        gl_Position.xy += (direction * corner.x + perpendicular * corner.y) * 2.0 / resolution * gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform vec3 diffuse;
      uniform float opacity;
      void main() {
        gl_FragColor = vec4(diffuse, opacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  let lastWidth = 0,
    lastHeight = 0,
    lastNear
  const lastMatrix = new Matrix4()
  const lastProjection = new Matrix4()
  const startView = new Vector3(),
    endView = new Vector3()
  const startScreen = new Vector3(),
    endScreen = new Vector3()
  const positions = [],
    starts = [],
    ends = [],
    corners = [],
    fractions = []

  function append(start, end, s) {
    const x = cyber ? config.size * 0.5 : 5
    const y = cyber ? config.size * 0.4 : 4
    for (const [cx, cy] of [
      [x, 0],
      [-x, y],
      [-x, -y],
    ]) {
      positions.push(start.x, start.y, start.z)
      starts.push(start.x, start.y, start.z)
      ends.push(end.x, end.y, end.z)
      corners.push(cx, cy)
      fractions.push(s)
    }
  }

  return {
    mesh,
    update(camera, width, height) {
      if (
        lastWidth === width &&
        lastHeight === height &&
        lastNear === camera.near &&
        lastMatrix.equals(camera.matrixWorld) &&
        lastProjection.equals(camera.projectionMatrix)
      )
        return
      lastWidth = width
      lastHeight = height
      lastNear = camera.near
      lastMatrix.copy(camera.matrixWorld)
      lastProjection.copy(camera.projectionMatrix)
      material.uniforms.resolution.value.set(width, height)
      positions.length = starts.length = ends.length = corners.length = fractions.length = 0
      for (let i = 1; i < points.length; i++) {
        startView.copy(points[i - 1]).applyMatrix4(camera.matrixWorldInverse)
        endView.copy(points[i]).applyMatrix4(camera.matrixWorldInverse)
        if (startView.z >= -camera.near || endView.z >= -camera.near) continue
        startScreen.copy(startView).applyMatrix4(camera.projectionMatrix)
        endScreen.copy(endView).applyMatrix4(camera.projectionMatrix)
        const dx = (endScreen.x - startScreen.x) * width * 0.5
        const dy = (endScreen.y - startScreen.y) * height * 0.5
        const length = Math.hypot(dx, dy)
        if (length < 24 || !Number.isFinite(length)) continue
        if (!cyber) {
          // 原有行为：空间中点，而非屏幕中点。
          const w0 = -startView.z,
            w1 = -endView.z
          append(points[i - 1], points[i], w1 / (w0 + w1))
          continue
        }
        const count = Math.max(1, Math.floor(length / Math.max(config.spacing, config.size * 2)))
        // 极长段只处理可见的屏幕区间，避免大坐标或极小 spacing 生成无限几何。
        let from = 0,
          to = 1
        for (const [p, d, extent] of [
          [startScreen.x, endScreen.x - startScreen.x, 1 + (config.size * 2) / width],
          [startScreen.y, endScreen.y - startScreen.y, 1 + (config.size * 2) / height],
        ]) {
          if (Math.abs(d) < 1e-10) {
            if (Math.abs(p) > extent) {
              to = -1
              break
            }
          } else {
            const a = (-extent - p) / d,
              b = (extent - p) / d
            from = Math.max(from, Math.min(a, b))
            to = Math.min(to, Math.max(a, b))
          }
        }
        if (to < from) continue
        const first = Math.max(0, Math.ceil(from * count - 0.5))
        const last = Math.min(count - 1, Math.floor(to * count - 0.5))
        const step = Math.max(1, Math.ceil((last - first + 1) / 1024))
        for (let j = first; j <= last; j += step)
          append(points[i - 1], points[i], (j + 0.5) / count)
      }
      if (
        !geometry.attributes.position ||
        geometry.attributes.position.array.length < positions.length
      ) {
        geometry.dispose()
        const capacity = Math.max(positions.length / 3, 96)
        for (const [name, size] of [
          ['position', 3],
          ['segmentStart', 3],
          ['segmentEnd', 3],
          ['corner', 2],
          ['fraction', 1],
        ])
          geometry.setAttribute(
            name,
            new Float32BufferAttribute(new Float32Array(capacity * size), size),
          )
      }
      for (const [name, values] of [
        ['position', positions],
        ['segmentStart', starts],
        ['segmentEnd', ends],
        ['corner', corners],
        ['fraction', fractions],
      ]) {
        geometry.attributes[name].array.set(values)
        geometry.attributes[name].needsUpdate = true
      }
      geometry.setDrawRange(0, positions.length / 3)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
