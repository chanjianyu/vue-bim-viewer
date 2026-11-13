import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  Vector3,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { isOpaqueSurface, ModelAmbientOcclusion } from './ambient-occlusion.js'

export function resolveRendering(value) {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : false,
    ambientOcclusion: typeof value?.ambientOcclusion === 'boolean' ? value.ambientOcclusion : false,
    shadows: typeof value?.shadows === 'boolean' ? value.shadows : false,
    exposure: Number.isFinite(value?.exposure) && value.exposure > 0 ? value.exposure : 1,
  }
}

/** 每个 Viewer 独立持有后处理与环境资源；仅由已有按需渲染调度调用。 */
export function createRendering(scene, camera, renderer, outline, invalidate) {
  const hemisphere = new HemisphereLight('#e5efff', '#758096', 2.6)
  const key = new DirectionalLight('#fff2dc', 2.7)
  const fill = new DirectionalLight('#a0c7ff', 1.5)
  key.position.set(3, 6, 5)
  fill.position.set(-4, 1, -2)
  scene.add(hemisphere, key, fill, key.target)
  const composer = new EffectComposer(renderer)
  const beauty = new RenderPass(scene, camera)
  const output = new OutputPass()
  const clearColor = new Color()
  let options = resolveRendering()
  let enhancement,
    failed = false,
    warned = false,
    destroyed = false
  let meshes = [],
    bounds,
    width = 1,
    height = 1
  let shadowsDirty = true

  function rebuildPasses() {
    composer.passes = [beauty]
    if (enhancement?.ao) composer.addPass(enhancement.ao)
    composer.addPass(outline)
    if (enhancement) composer.addPass(enhancement.smaa)
    composer.addPass(output)
    composer.setSize(width, height)
  }

  function releaseShadow() {
    key.shadow.map?.dispose()
    key.shadow.mapPass?.dispose()
    key.shadow.map = null
    key.shadow.mapPass = null
    shadowsDirty = true
  }

  function releaseEnhancement() {
    const previous = enhancement
    enhancement = undefined
    if (previous) {
      previous.cleanups.forEach((cleanup) => cleanup())
      previous.ao?.dispose()
      previous.smaa.dispose()
      previous.environment?.dispose()
    }
    scene.environment = null
    scene.environmentIntensity = 1
    renderer.toneMapping = NoToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = false
    key.castShadow = false
    releaseShadow()
    hemisphere.color.set('#e5efff')
    hemisphere.groundColor.set('#758096')
    hemisphere.intensity = 2.6
    key.color.set('#fff2dc')
    key.intensity = 2.7
    key.position.set(3, 6, 5)
    key.target.position.set(0, 0, 0)
    fill.color.set('#a0c7ff')
    fill.intensity = 1.5
    rebuildPasses()
  }

  function fallback(cause) {
    failed = true
    releaseEnhancement()
    if (!warned) {
      warned = true
      console.warn('[vue-bim-viewer] 渲染增强不可用，已回退基础渲染。', cause)
    }
    invalidate()
  }

  function fitShadow() {
    if (!bounds || bounds.isEmpty()) return
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() * 0.5, 0.001)
    key.position.copy(center).addScaledVector(new Vector3(3, 6, 5).normalize(), radius * 2)
    key.target.position.copy(center)
    const shadowCamera = key.shadow.camera
    shadowCamera.left = shadowCamera.bottom = -radius * 1.05
    shadowCamera.right = shadowCamera.top = radius * 1.05
    shadowCamera.near = radius * 0.01
    shadowCamera.far = radius * 4
    shadowCamera.updateProjectionMatrix()
    const size = Math.min(2048, 2 ** Math.floor(Math.log2(renderer.capabilities.maxTextureSize)))
    key.shadow.mapSize.set(size, size)
    key.shadow.bias = -0.0002
    // 按阴影纹素的世界尺寸偏移，避免完整大模型范围下屋面产生自阴影条纹。
    key.shadow.normalBias = ((radius * 2.1) / size) * 0.75
    key.shadow.radius = 2
    key.shadow.intensity = 0.65
    shadowsDirty = true
  }

  function initialize() {
    if (
      !renderer.extensions.has('EXT_color_buffer_float') &&
      !renderer.extensions.has('EXT_color_buffer_half_float')
    ) {
      throw new Error('当前设备不支持渲染增强所需的半浮点颜色缓冲')
    }
    // 所有创建成功的资源立即登记，后续任何步骤失败也能完整释放。
    enhancement = { smaa: new SMAAPass(), cleanups: [] }
    const candidate = enhancement
    candidate.smaa.enabled = false
    const images = [candidate.smaa._areaTexture.image, candidate.smaa._searchTexture.image]
    const ready = () => {
      if (destroyed || enhancement !== candidate) return
      candidate.smaa.enabled = images.every((image) => image.complete && image.naturalWidth > 0)
      if (candidate.smaa.enabled) invalidate()
    }
    const error = () => {
      if (!destroyed && enhancement === candidate) fallback(new Error('SMAA 查找纹理加载失败'))
    }
    for (const image of images) {
      image.addEventListener('load', ready)
      image.addEventListener('error', error)
      candidate.cleanups.push(() => {
        image.removeEventListener('load', ready)
        image.removeEventListener('error', error)
      })
    }
    ready()
    const environment = new RoomEnvironment()
    let generator
    try {
      generator = new PMREMGenerator(renderer)
      candidate.environment = generator.fromScene(environment)
    } finally {
      generator?.dispose()
      environment.dispose()
    }
    scene.environment = candidate.environment.texture
    scene.environmentIntensity = 0.4
    hemisphere.color.set('#eef2f7')
    hemisphere.groundColor.set('#8a9199')
    hemisphere.intensity = 1.3
    key.color.set('#fffaf3')
    key.intensity = 2.1
    fill.color.set('#e3edff')
    fill.intensity = 0.7
  }

  function configure() {
    if (!options.enabled) {
      releaseEnhancement()
      return
    }
    if (failed) return
    try {
      if (!enhancement) initialize()
      if (options.ambientOcclusion && !enhancement.ao) {
        enhancement.ao = new ModelAmbientOcclusion(scene, camera)
        enhancement.ao.setModel(meshes, bounds)
      } else if (!options.ambientOcclusion && enhancement.ao) {
        enhancement.ao.dispose()
        enhancement.ao = undefined
      }
      renderer.toneMapping = NeutralToneMapping
      renderer.toneMappingExposure = options.exposure
      renderer.shadowMap.enabled = options.shadows
      renderer.shadowMap.type = PCFShadowMap
      renderer.shadowMap.autoUpdate = false
      key.castShadow = options.shadows
      if (options.shadows) fitShadow()
      else {
        releaseShadow()
        key.position.set(3, 6, 5)
        key.target.position.set(0, 0, 0)
      }
      rebuildPasses()
    } catch (cause) {
      fallback(cause)
    }
  }

  rebuildPasses()
  return {
    set(value) {
      if (destroyed) return
      const next = resolveRendering(value)
      if (!options.enabled && next.enabled) failed = false
      options = next
      configure()
      invalidate()
    },
    setModel(root) {
      releaseShadow()
      meshes = []
      root.traverse((object) => {
        if (object.isMesh) meshes.push(object)
      })
      bounds = new Box3().setFromObject(root, true)
      enhancement?.ao?.setModel(meshes, bounds)
      if (enhancement && options.shadows) fitShadow()
    },
    invalidateShadows() {
      shadowsDirty = true
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      composer.setSize(width, height)
    },
    render(selected) {
      const restored = []
      const target = renderer.getRenderTarget()
      const autoClear = renderer.autoClear
      const clearAlpha = renderer.getClearAlpha()
      renderer.getClearColor(clearColor)
      const restoreRenderer = () => {
        renderer.autoClear = autoClear
        renderer.setClearColor(clearColor, clearAlpha)
        renderer.setRenderTarget(target)
      }
      try {
        outline.enabled = selected
        if (enhancement) {
          if (options.shadows) {
            for (const mesh of meshes) {
              restored.push([mesh, mesh.castShadow, mesh.receiveShadow])
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
              // 混合透明材质的 Mesh 保守排除投影，避免透明材质组成为实心阴影。
              mesh.castShadow = mesh.receiveShadow = materials.every(isOpaqueSurface)
            }
            renderer.shadowMap.needsUpdate = shadowsDirty
          }
          composer.render()
          shadowsDirty = false
        } else if (selected) composer.render()
        else renderer.render(scene, camera)
      } catch (cause) {
        if (!enhancement) throw cause
        fallback(cause)
        restoreRenderer()
        renderer.render(scene, camera)
      } finally {
        for (const [mesh, cast, receive] of restored) {
          mesh.castShadow = cast
          mesh.receiveShadow = receive
        }
        restoreRenderer()
      }
    },
    dispose() {
      destroyed = true
      releaseEnhancement()
      composer.dispose()
      output.dispose()
      scene.remove(hemisphere, key, fill, key.target)
      meshes = []
      bounds = undefined
    },
  }
}
