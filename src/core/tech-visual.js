import { Color, EdgesGeometry, Group, MeshBasicMaterial, Scene, Vector3 } from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const colorPattern = /^#[0-9a-f]{6}$/i
const color = (value, fallback) =>
  typeof value === 'string' && colorPattern.test(value) ? value : fallback
const number = (value, fallback, min, max) =>
  Number.isFinite(value) && value >= min && value <= max ? value : fallback

export function resolveTechVisual(value) {
  const minimal = value?.preset === 'minimal'
  const model = value?.model || {}
  const edges = model.edges || {}
  return {
    enabled: value?.enabled === true,
    preset: minimal ? 'minimal' : 'cyber',
    model: {
      opacity: number(model.opacity, minimal ? 0.48 : 0.34, 0, 1),
      tint: color(model.tint, minimal ? '#26384d' : '#10243d'),
      brightness: number(model.brightness, minimal ? 0.78 : 0.62, 0, 2),
      saturation: number(model.saturation, minimal ? 0.58 : 0.32, 0, 1),
      edges: {
        enabled: typeof edges.enabled === 'boolean' ? edges.enabled : true,
        scope: edges.scope === 'all' ? 'all' : 'connected',
        color: color(edges.color, minimal ? '#7dd3fc' : '#58e6ff'),
        opacity: number(edges.opacity, minimal ? 0.45 : 0.78, 0, 1),
        width: number(edges.width, minimal ? 1 : 1.2, 0.1, 20),
        thresholdAngle: number(edges.thresholdAngle, 25, 0, 180),
      },
    },
  }
}

function isVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  return materials.some((material) => material.visible && material.opacity > 0)
}

/** 模型专属临时材质；不写入 appearance，不把纹理交给临时资源释放。 */
export function createTechVisual(invalidate) {
  const edgeScene = new Scene()
  const edgeGroup = new Group()
  edgeScene.add(edgeGroup)
  const materialEntries = new Map()
  const geometryCache = new Map()
  const edgeEntries = new Map()
  const warned = new Set()
  let options = resolveTechVisual()
  let meshes = []
  let connectedMeshes = []
  let restored = []
  let width = 1,
    height = 1,
    failed = false
  const warn = (kind, error) => {
    if (warned.has(kind)) return
    warned.add(kind)
    console.warn(
      '[vue-bim-viewer] ' +
        (kind === 'edges' ? '科技边缘线不可用，已跳过。' : '科技材质不可用，已回退普通模型。'),
      error,
    )
  }

  function endRender() {
    restored.forEach(([mesh, material]) => {
      mesh.material = material
    })
    restored = []
  }
  function clearMaterials() {
    endRender()
    materialEntries.forEach(({ material }) => material.dispose())
    materialEntries.clear()
  }
  function clearEdges(releaseCache = false) {
    edgeEntries.forEach(({ line }) => edgeGroup.remove(line))
    edgeEntries.clear()
    if (releaseCache) {
      geometryCache.forEach((geometry) => geometry.dispose())
      geometryCache.clear()
    }
  }
  let edgeMaterial
  function rebuildEdges() {
    clearEdges()
    edgeMaterial?.dispose()
    edgeMaterial = undefined
    if (!options.enabled || !options.model.edges.enabled) return
    const config = options.model.edges
    edgeMaterial = new LineMaterial({
      color: config.color,
      linewidth: config.width,
      worldUnits: false,
      transparent: true,
      opacity: config.opacity,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    })
    // LineSegments2 默认从渲染目标读取像素尺寸；这里固定使用 CSS 像素。
    edgeMaterial.resolution.set(width, height)
    for (const mesh of new Set(config.scope === 'all' ? meshes : connectedMeshes)) {
      if (mesh.isInstancedMesh || !mesh.geometry?.attributes.position) continue
      let snapshot, edges, geometry
      try {
        const deformed = mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length
        const key = (deformed ? mesh.uuid : mesh.geometry.uuid) + ':' + config.thresholdAngle
        geometry = geometryCache.get(key)
        if (!geometry) {
          let input = mesh.geometry
          if (deformed) {
            snapshot = mesh.geometry.clone()
            mesh.skeleton?.update()
            const position = snapshot.attributes.position
            const point = new Vector3()
            for (let i = 0; i < position.count; i++) {
              mesh.getVertexPosition(i, point)
              position.setXYZ(i, point.x, point.y, point.z)
            }
            input = snapshot
          }
          edges = new EdgesGeometry(input, config.thresholdAngle)
          const positions = edges.getAttribute('position').array
          if (!positions.length) continue
          geometry = new LineSegmentsGeometry().setPositions(positions)
          geometryCache.set(key, geometry)
        }
        const line = new LineSegments2(geometry, edgeMaterial)
        line.onBeforeRender = () => edgeMaterial.resolution.set(width, height)
        line.frustumCulled = false
        line.matrixAutoUpdate = false
        edgeGroup.add(line)
        edgeEntries.set(mesh, { line })
      } catch (error) {
        warn('edges', error)
      } finally {
        edges?.dispose()
        snapshot?.dispose()
      }
    }
  }

  function wrap(source) {
    const config = options.model
    let entry = materialEntries.get(source)
    if (entry?.version === source.version) return entry.material
    entry?.material.dispose()
    const standard = [
      'MeshBasicMaterial',
      'MeshStandardMaterial',
      'MeshPhysicalMaterial',
      'MeshPhongMaterial',
      'MeshLambertMaterial',
      'MeshToonMaterial',
    ].includes(source.type)
    const material = standard
      ? source.clone()
      : new MeshBasicMaterial({
          color: config.tint,
          opacity: source.opacity,
          visible: source.visible,
          side: source.side,
          alphaTest: source.alphaTest,
          map: source.map || null,
          alphaMap: source.alphaMap || null,
          clippingPlanes: source.clippingPlanes,
        })
    material.transparent = true
    material.opacity = source.opacity * config.opacity
    material.depthWrite = false
    if (standard) {
      material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(material, shader, renderer)
        shader.uniforms.bimTechTint = { value: new Color(config.tint) }
        shader.uniforms.bimTechBrightness = { value: config.brightness }
        shader.uniforms.bimTechSaturation = { value: config.saturation }
        // 处理最终出射光，包含自发光材质；纹理、法线和 alpha 裁剪仍沿用原 Shader。
        const anchor = '#include <opaque_fragment>'
        if (!shader.fragmentShader.includes(anchor)) throw new Error('材质缺少科技着色扩展点')
        shader.fragmentShader =
          'uniform vec3 bimTechTint;\nuniform float bimTechBrightness;\nuniform float bimTechSaturation;\n' +
          shader.fragmentShader.replace(
            anchor,
            `
          float bimTechLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight = mix(mix(vec3(bimTechLuma), outgoingLight, bimTechSaturation) * bimTechBrightness, bimTechTint, 0.34);
          ${anchor}
        `,
          )
      }
      material.customProgramCacheKey = () => source.customProgramCacheKey() + ':bim-tech-v1'
    }
    materialEntries.set(source, { version: source.version, material })
    return material
  }

  return {
    set(value) {
      const next = resolveTechVisual(value)
      if (JSON.stringify(next) === JSON.stringify(options)) return false
      const angleChanged = next.model.edges.thresholdAngle !== options.model.edges.thresholdAngle
      options = next
      failed = false
      clearMaterials()
      if (angleChanged || !next.enabled) clearEdges(true)
      rebuildEdges()
      invalidate()
      return true
    },
    setModel(root) {
      clearMaterials()
      clearEdges(true)
      meshes = []
      connectedMeshes = []
      root.traverse((mesh) => {
        if (mesh.isMesh) meshes.push(mesh)
      })
      failed = false
      rebuildEdges()
    },
    setConnectedMeshes(values) {
      const next = [...new Set(values)]
      if (
        next.length === connectedMeshes.length &&
        next.every((mesh, i) => mesh === connectedMeshes[i])
      )
        return
      connectedMeshes = next
      rebuildEdges()
      invalidate()
    },
    resize(w, h) {
      width = w
      height = h
      edgeMaterial?.resolution.set(w, h)
    },
    beginRender(selected = []) {
      if (!options.enabled || failed) return
      const excluded = new Set(selected)
      const used = new Set()
      try {
        for (const mesh of meshes) {
          if (excluded.has(mesh)) continue
          const source = mesh.material
          const values = Array.isArray(source) ? source : [source]
          const materials = values.map((material) => {
            used.add(material)
            return wrap(material)
          })
          restored.push([mesh, source])
          mesh.material = Array.isArray(source) ? materials : materials[0]
        }
        for (const [source, entry] of materialEntries)
          if (!used.has(source)) {
            entry.material.dispose()
            materialEntries.delete(source)
          }
      } catch (error) {
        endRender()
        failed = true
        warn('material', error)
      }
    },
    endRender,
    renderEdges(renderer, camera) {
      if (!options.enabled || !edgeEntries.size) return
      for (const [mesh, { line }] of edgeEntries) {
        line.visible = isVisible(mesh)
        mesh.updateWorldMatrix(true, false)
        line.matrix.copy(mesh.matrixWorld)
      }
      const autoClear = renderer.autoClear
      try {
        renderer.autoClear = false
        renderer.render(edgeScene, camera)
      } finally {
        renderer.autoClear = autoClear
      }
    },
    fail(error) {
      if (!options.enabled || failed) return false
      failed = true
      warn('material', error)
      invalidate()
      return true
    },
    dispose() {
      clearMaterials()
      clearEdges(true)
      edgeMaterial?.dispose()
      meshes = []
      connectedMeshes = []
    },
  }
}
