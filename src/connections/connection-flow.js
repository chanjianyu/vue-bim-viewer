import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three'

/** 每条路径一个光点；复用几何与位置 uniform，计时和帧调度交给连接线管理器。 */
export function createConnectionFlow(points, path, options) {
  const geometry = new PlaneGeometry(1, 1)
  let material
  try {
    material = new ShaderMaterial({
      uniforms: {
        point: { value: points[0].clone() },
        resolution: { value: new Vector2(1, 1) },
        size: { value: options.flow.size },
        diffuse: { value: new Color(options.flow.color) },
        opacity: { value: options.opacity },
        nearClip: { value: 0.01 },
      },
      vertexShader: `
        uniform vec3 point;
        uniform vec2 resolution;
        uniform float size;
        uniform float nearClip;
        varying vec2 vUv;
        varying float vVisible;
        void main() {
          vUv = uv;
          vec4 center = modelViewMatrix * vec4(point, 1.0);
          vVisible = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          if (center.z >= -nearClip) return;
          gl_Position = projectionMatrix * center;
          gl_Position.xy += position.xy * size * 2.0 / resolution * gl_Position.w;
          vVisible = 1.0;
        }
      `,
      fragmentShader: `
        uniform vec3 diffuse;
        uniform float opacity;
        varying vec2 vUv;
        varying float vVisible;
        void main() {
          float radius = length(vUv * 2.0 - 1.0);
          if (vVisible < 0.5 || radius >= 1.0) discard;
          float glow = 1.0 - smoothstep(0.15, 1.0, radius);
          gl_FragColor = vec4(diffuse, opacity * glow);
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
    mesh.renderOrder = 1
    return {
      mesh,
      update(elapsed, camera, width, height) {
        const distance =
          ((elapsed % options.flow.duration) / options.flow.duration) * path.totalLength
        // 二分定位路径段；经过拐点时不缓动，也不生成首尾连接段。
        let low = 0,
          high = path.lengths.length - 1
        while (low < high) {
          const middle = (low + high) >>> 1
          if (distance < path.cumulativeLengths[middle + 1]) high = middle
          else low = middle + 1
        }
        material.uniforms.point.value.lerpVectors(
          points[low],
          points[low + 1],
          (distance - path.cumulativeLengths[low]) / path.lengths[low],
        )
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
