import { Color, Vector2 } from 'three'
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js'

const tint = new Color('#28c99a')
const tintStrength = 0.65

class ComponentOutlinePass extends OutlinePass {
  _updateSelectionCache() {
    // 固定版 OutlinePass 默认递归 Mesh 的后代；这里仅使用已按外观过滤的精确网格集合。
    this._selectionCache.clear()
    this.selectedObjects.forEach((mesh) => this._selectionCache.add(mesh))
  }
}

/** 选择只在绘制期间覆盖材质，不修改源材质或持久化外观。 */
export function createSelection(scene, camera) {
  const pass = new ComponentOutlinePass(new Vector2(1, 1), scene, camera)
  pass.visibleEdgeColor.set('#b4fff0')
  pass.hiddenEdgeColor.set('#000000')
  pass.edgeStrength = 2
  pass.edgeThickness = 1
  pass.edgeGlow = 0
  pass.pulsePeriod = 0
  const materials = new Map()
  let selected = null

  function releaseUnused(used) {
    for (const [source, entry] of materials) {
      if (used?.has(source)) continue
      entry.material.dispose()
      materials.delete(source)
    }
  }

  function highlight(source, used) {
    if (!source.visible || source.opacity <= 0 || !source.color?.isColor) return source
    used.add(source)
    let entry = materials.get(source)
    if (!entry) {
      entry = { material: source.clone(), version: -1 }
      materials.set(source, entry)
    }
    if (entry.version !== source.version) {
      entry.material.copy(source)
      // 在贴图和顶点颜色之后混色，避免饱和的源颜色把选中绿色乘掉；光照照常计算。
      entry.material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(entry.material, shader, renderer)
        shader.uniforms.selectionTint = { value: tint }
        shader.fragmentShader =
          'uniform vec3 selectionTint;\n' +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, selectionTint, ${tintStrength});`,
          )
      }
      entry.material.customProgramCacheKey = () =>
        `${source.customProgramCacheKey()}:bim-selection-tint`
      entry.material.needsUpdate = true
      entry.version = source.version
    }
    return entry.material
  }

  return {
    pass,
    select(object) {
      if (selected === object) return
      selected = object
      pass.selectedObjects = []
      releaseUnused()
    },
    render(components, appearance, draw) {
      const meshes = []
      let visible = Boolean(selected && components && appearance)
      for (let object = selected; object && visible; object = object.parent)
        visible = object.visible
      if (visible)
        selected.traverseVisible((mesh) => {
          if (!mesh.isMesh) return
          const state = appearance.get(components.byObject.get(mesh) || '')?.effective
          const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          if (
            state?.visible &&
            state.opacity > 0 &&
            source.some((material) => material.visible && material.opacity > 0)
          )
            meshes.push(mesh)
        })
      pass.selectedObjects = meshes
      const restored = new Map()
      const used = new Set()
      try {
        for (const mesh of meshes) {
          const source = mesh.material
          restored.set(mesh, source)
          mesh.material = Array.isArray(source)
            ? source.map((material) => highlight(material, used))
            : highlight(source, used)
        }
        draw(meshes.length > 0)
      } finally {
        restored.forEach((material, mesh) => {
          mesh.material = material
        })
        releaseUnused(used)
      }
    },
    dispose() {
      selected = null
      pass.selectedObjects = []
      releaseUnused()
      pass.dispose()
    },
  }
}
