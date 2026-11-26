import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'

/** 一个批量 Mesh：发光头部和沿实际折线路径回溯的柔光尾迹；复用全部 GPU 属性。 */
export function createConnectionFlow(points, path, options) {
  const config = options.visual.pulse
  const tailCount =
    config.trail > 0
      ? Math.min(128, Math.max(8, Math.ceil(config.trail / Math.max(1, config.size * 0.15))))
      : 0
  const count = tailCount + 1
  const positions = new Float32Array(count * 18)
  const corners = new Float32Array(count * 12)
  const strengths = new Float32Array(count * 6)
  const quad = [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]
  for (let i = 0; i < count; i++) corners.set(quad, i * 12)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  geometry.setAttribute('strength', new Float32BufferAttribute(strengths, 1))
  let material
  const point = new Vector3(),
    view = new Vector3(),
    screen = new Vector3(),
    previous = new Vector3()
  function at(distance, target) {
    let low = 0,
      high = path.lengths.length - 1
    while (low < high) {
      const middle = (low + high) >>> 1
      if (distance < path.cumulativeLengths[middle + 1]) high = middle
      else low = middle + 1
    }
    target.lerpVectors(
      points[low],
      points[low + 1],
      Math.max(0, Math.min(1, (distance - path.cumulativeLengths[low]) / path.lengths[low])),
    )
  }
  try {
    material = new ShaderMaterial({
      uniforms: {
        resolution: { value: new Vector2(1, 1) },
        size: { value: config.size },
        diffuse: { value: new Color(config.color) },
        opacity: { value: options.visual.core.opacity },
        nearClip: { value: 0.01 },
      },
      vertexShader: `
        attribute vec2 corner;
        attribute float strength;
        uniform vec2 resolution;
        uniform float size;
        uniform float nearClip;
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          vUv = corner * 2.0;
          vStrength = strength;
          vec4 center = modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          if (center.z >= -nearClip || strength <= 0.0) { vStrength = 0.0; return; }
          gl_Position = projectionMatrix * center;
          gl_Position.xy += corner * size * 2.0 / resolution * gl_Position.w;
        }
      `,
      fragmentShader: `
        uniform vec3 diffuse;
        uniform float opacity;
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          float radius = length(vUv);
          if (vStrength <= 0.0 || radius >= 1.0) discard;
          float glow = 1.0 - smoothstep(0.15, 1.0, radius);
          gl_FragColor = vec4(diffuse, opacity * glow * vStrength);
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
    mesh.renderOrder = 5
    return {
      mesh,
      update(elapsed, camera, width, height) {
        let distance = (elapsed / options.visual.duration) * path.totalLength
        // 尾迹先绘制、头部最后绘制；不跨过起点，不生成终点到起点的虚假线段。
        for (let i = 0; i < count; i++) {
          const index = count - i - 1
          at(Math.max(0, distance), point)
          const strength = distance < 0 ? 0 : i === 0 ? 1 : Math.pow(1 - i / count, 1.6) * 0.22
          for (let v = 0; v < 6; v++) {
            geometry.attributes.position.setXYZ(index * 6 + v, point.x, point.y, point.z)
            geometry.attributes.strength.setX(index * 6 + v, strength)
          }
          if (!tailCount) break
          view.copy(point).applyMatrix4(camera.matrixWorldInverse)
          screen.copy(point).project(camera)
          const probe = Math.min(
            Math.max(path.totalLength * 0.00001, 0.000001),
            Math.max(distance, 0.000001),
          )
          at(Math.max(0, distance - probe), previous)
          previous.project(camera)
          const pixelDelta = Math.hypot(
            (screen.x - previous.x) * width * 0.5,
            (screen.y - previous.y) * height * 0.5,
          )
          const worldPerPixel =
            pixelDelta > 0.0001
              ? probe / pixelDelta
              : (Math.abs(view.z) * 2) / (height * camera.projectionMatrix.elements[5])
          distance -= (config.trail / tailCount) * worldPerPixel
        }
        geometry.attributes.position.needsUpdate = true
        geometry.attributes.strength.needsUpdate = true
        material.uniforms.resolution.value.set(width, height)
        material.uniforms.nearClip.value = camera.near
      },
      dispose() {
        geometry.dispose()
        material.dispose()
      },
    }
  } catch (error) {
    geometry.dispose()
    material?.dispose()
    throw error
  }
}
