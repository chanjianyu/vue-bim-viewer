import { BufferGeometry, Color, Float32BufferAttribute, Mesh, ShaderMaterial, Vector2 } from 'three'

/** 每条折线共用一个箭头 Mesh；方向和像素尺寸由当前相机在顶点着色器中计算。 */
export function createConnectionArrows(points, options) {
  const positions = [],
    starts = [],
    ends = [],
    corners = []
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1],
      end = points[i]
    const midpoint = start.clone().lerp(end, 0.5)
    for (const corner of [
      [5, 0],
      [-5, 4],
      [-5, -4],
    ]) {
      positions.push(...midpoint.toArray())
      starts.push(...start.toArray())
      ends.push(...end.toArray())
      corners.push(...corner)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('segmentStart', new Float32BufferAttribute(starts, 3))
  geometry.setAttribute('segmentEnd', new Float32BufferAttribute(ends, 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  const material = new ShaderMaterial({
    uniforms: {
      diffuse: { value: new Color(options.color) },
      opacity: { value: options.opacity },
      resolution: { value: new Vector2(1, 1) },
      nearClip: { value: 0.01 },
    },
    vertexShader: `
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      attribute vec2 corner;
      uniform vec2 resolution;
      uniform float nearClip;
      varying float vVisible;
      void main() {
        vec4 start = modelViewMatrix * vec4(segmentStart, 1.0);
        vec4 end = modelViewMatrix * vec4(segmentEnd, 1.0);
        vVisible = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        if (start.z >= -nearClip || end.z >= -nearClip) return;
        vec4 clipStart = projectionMatrix * start;
        vec4 clipEnd = projectionMatrix * end;
        vec2 delta = (clipEnd.xy / clipEnd.w - clipStart.xy / clipStart.w) * resolution * 0.5;
        float lengthPx = length(delta);
        if (lengthPx < 24.0) return;
        vec2 direction = delta / lengthPx;
        vec2 perpendicular = vec2(-direction.y, direction.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.xy += (direction * corner.x + perpendicular * corner.y) * 2.0 / resolution * gl_Position.w;
        vVisible = 1.0;
      }
    `,
    fragmentShader: `
      uniform vec3 diffuse;
      uniform float opacity;
      varying float vVisible;
      void main() {
        if (vVisible < 0.5) discard;
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
  mesh.visible = options.showArrows
  return {
    mesh,
    update(camera, width, height) {
      material.uniforms.nearClip.value = camera.near
      material.uniforms.resolution.value.set(width, height)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
