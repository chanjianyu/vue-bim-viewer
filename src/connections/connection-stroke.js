import { Line2 } from 'three/addons/lines/Line2.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

/** 线路自己发光，避免全屏 Bloom 改变 GIS 和背景。 */
export function createConnectionStroke(geometry, style, order, soft = false) {
  const material = new LineMaterial({
    color: style.color,
    linewidth: style.width,
    opacity: style.opacity,
    worldUnits: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  if (soft) {
    material.fragmentShader = material.fragmentShader.replace(
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      'alpha *= pow(max(0.0, 1.0 - abs(vUv.x)), 1.8);\ngl_FragColor = vec4( diffuseColor.rgb, alpha );',
    )
  }
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.renderOrder = order
  // 由调用方传 CSS 尺寸，避免 DPR=2 时线宽减半。
  line.onBeforeRender = () => {}
  return line
}
