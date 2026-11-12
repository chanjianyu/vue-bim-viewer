import { Color, MeshNormalMaterial, Vector3 } from 'three'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'

/** 透明、透射和线框表面不作为实心遮挡；按材质组判断。 */
export function isOpaqueSurface(material) {
  return Boolean(
    material?.visible &&
    !material.transparent &&
    material.opacity >= 1 &&
    !(material.transmission > 0) &&
    !material.wireframe,
  )
}

/** 固定 Three.js 版本的 GTAO 适配：半分辨率，只采集模型的不透明材质组。 */
export class ModelAmbientOcclusion extends GTAOPass {
  constructor(scene, camera) {
    super(scene, camera, 1, 1)
    this.modelMeshes = new Set()
    this.normalMaterials = new Map()
    this.clearColor = new Color()
    this.blendIntensity = 0.3
    this.updateGtaoMaterial({ samples: 8, screenSpaceRadius: true, radius: 0.12 })
    this.updatePdMaterial({ samples: 8, radius: 4 })
  }

  setSize(width, height) {
    super.setSize(Math.max(1, Math.ceil(width * 0.5)), Math.max(1, Math.ceil(height * 0.5)))
  }

  setModel(meshes, bounds) {
    this.clearMaterials()
    this.modelMeshes = new Set(meshes)
    this.enabled = meshes.length > 0
    // GTAO 的厚度阈值仍使用场景单位；与模型尺度一起缩放，兼容米制与毫米制模型。
    if (bounds && !bounds.isEmpty()) {
      this.updateGtaoMaterial({ thickness: bounds.getSize(new Vector3()).length() * 0.0005 })
    }
  }

  clearMaterials(used) {
    for (const [source, entry] of this.normalMaterials) {
      if (used?.has(source)) continue
      entry.material.dispose()
      this.normalMaterials.delete(source)
    }
  }

  normalFor(source, used) {
    used.add(source)
    let entry = this.normalMaterials.get(source)
    if (!entry) {
      const material = new MeshNormalMaterial()
      // MeshNormalMaterial 本身不裁剪 alpha 贴图；补齐裁剪以免孔洞成为实心遮挡。
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <normal_pars_fragment>',
            '#include <normal_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>',
          )
          .replace(
            '#include <clipping_planes_fragment>',
            '#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>\n#include <alphatest_fragment>',
          )
      }
      entry = { material, version: -1 }
      this.normalMaterials.set(source, entry)
    }
    if (entry.version !== source.version) {
      for (const name of [
        'side',
        'flatShading',
        'map',
        'alphaMap',
        'alphaTest',
        'normalMap',
        'normalMapType',
        'bumpMap',
        'bumpScale',
        'displacementMap',
        'displacementScale',
        'displacementBias',
        'clippingPlanes',
        'clipIntersection',
      ]) {
        if (name in source) entry.material[name] = source[name]
      }
      if (source.normalScale) entry.material.normalScale.copy(source.normalScale)
      entry.material.needsUpdate = true
      entry.version = source.version
    }
    entry.material.visible = isOpaqueSurface(source)
    return entry.material
  }

  // 基类通过 visible 排除线条，会连带隐藏后代；这里统一使用下方的材质和图层过滤。
  _overrideVisibility() {}

  _restoreVisibility() {}

  _renderOverride(renderer, _material, target, color, alpha) {
    const restored = []
    const used = new Set()
    const background = this.scene.background
    const override = this.scene.overrideMaterial
    const autoClear = renderer.autoClear
    const clearAlpha = renderer.getClearAlpha()
    const renderTarget = renderer.getRenderTarget()
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate
    renderer.getClearColor(this.clearColor)
    try {
      this.scene.background = null
      this.scene.overrideMaterial = null
      // 不修改 visible，避免隐藏父 Mesh 时连带排除其不透明子构件。
      this.scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isLine && !object.isPoints && !object.isSprite) return
        restored.push([object, object.material, object.layers.mask])
        if (this.modelMeshes.has(object)) {
          object.material = Array.isArray(object.material)
            ? object.material.map((source) => this.normalFor(source, used))
            : this.normalFor(object.material, used)
        } else object.layers.mask = 0
      })
      renderer.shadowMap.autoUpdate = false
      renderer.shadowMap.needsUpdate = false
      renderer.autoClear = false
      renderer.setRenderTarget(target)
      renderer.setClearColor(color, alpha)
      renderer.clear()
      renderer.render(this.scene, this.camera)
    } finally {
      for (const [object, material, mask] of restored) {
        object.material = material
        object.layers.mask = mask
      }
      this.scene.background = background
      this.scene.overrideMaterial = override
      renderer.autoClear = autoClear
      renderer.setClearColor(this.clearColor, clearAlpha)
      renderer.setRenderTarget(renderTarget)
      renderer.shadowMap.autoUpdate = shadowAutoUpdate
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate
      this.clearMaterials(used)
    }
  }

  dispose() {
    this.clearMaterials()
    this.modelMeshes.clear()
    // r183 的基类 dispose 未释放这两个材质。
    this.gtaoMaterial.dispose()
    this.blendMaterial.dispose()
    super.dispose()
  }
}
