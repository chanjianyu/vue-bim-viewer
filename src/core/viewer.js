import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { createBackground } from './background.js'
import { createSelection } from '../model/selection.js'
import { createCameraMotion, createPointView, createClusterView } from '../camera/camera-motion.js'
import { createCameraZoom } from '../camera/camera-zoom.js'
import { createCameraZoomLimit } from '../camera/camera-zoom-limit.js'
import {
  createCameraView,
  getCameraViewState,
  validateViewState,
} from '../camera/camera-view-state.js'
import { createCameraNavigation } from '../camera/navigation/camera-navigation.js'
import { projectMarkers } from '../markers/markers.js'
import { createImageryPlan } from '../gis/projection.js'
import { createImageryLayer } from '../gis/layer.js'
import { createConnectionLines } from '../connections/connection-lines.js'
import { connectionLineFailure } from '../connections/connection-line-data.js'

/** 一个 Viewer 管理自己的 GPU、相机、选择效果及可选影像层；不包含矿山业务数据。 */
export function createViewer(
  container,
  onOverlay,
  onContextLost,
  onGisStatus,
  onBackgroundError,
  onNavigation,
  onTerrainStatus,
) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(42, 1, 0.01, 100000)
  const renderer = new WebGLRenderer({ antialias: true })
  const connections = createConnectionLines()
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.setAttribute('aria-label', '三维模型：拖动旋转，滚轮缩放，右键平移')
  renderer.domElement.setAttribute('role', 'img')
  container.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  const motion = createCameraMotion(camera, controls)
  const zoomLimit = createCameraZoomLimit(camera, controls, renderer.domElement)
  const zoom = createCameraZoom(camera, controls, motion, zoomLimit)
  const navigation = createCameraNavigation(camera, controls, motion)
  controls.addEventListener('start', startInteraction)
  scene.add(new HemisphereLight('#e5efff', '#758096', 2.6))
  const key = new DirectionalLight('#fff2dc', 2.7)
  key.position.set(3, 6, 5)
  scene.add(key)
  const fill = new DirectionalLight('#a0c7ff', 1.5)
  fill.position.set(-4, 1, -2)
  scene.add(fill)
  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const selection = createSelection(scene, camera)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(selection.pass)
  composer.addPass(output)
  let current, components, appearance
  let markers = [],
    width = 0,
    height = 0,
    frame = 0,
    destroyed = false
  let initialView
  let viewWarning
  let overlayDirty = true,
    projectedOverlay,
    lastCameraMatrix,
    lastProjectionMatrix,
    clusterOperation
  const markerSignature = (marker) =>
    JSON.stringify([
      marker.modelPosition.x,
      marker.modelPosition.y,
      marker.modelPosition.z,
      marker.screenOffset?.x || 0,
      marker.screenOffset?.y || 0,
    ])
  function startInteraction() {
    motion.cancel()
    zoom.clearPending()
    clusterOperation = undefined
  }
  function cancelClusterFocus() {
    if (!clusterOperation) return
    motion.cancel()
    clusterOperation = undefined
  }
  let imagery
  let imageryIdentity = ''
  let terrainHeightTransform
  let navigationVisible = false,
    lastOrientation,
    contextAvailable = true
  const ownerDocument = container.ownerDocument
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  function playbackChanged() {
    // 暂停时间不计入下一帧；不取消相机或 GIS 仍需使用的共享帧。
    connections.pause()
    invalidate()
  }
  ownerDocument.addEventListener('visibilitychange', playbackChanged)
  reducedMotion?.addEventListener('change', playbackChanged)
  const background = createBackground(scene, invalidate, onBackgroundError)
  function clearImagery() {
    imagery?.dispose()
    imagery = undefined
    imageryIdentity = ''
    terrainHeightTransform = undefined
  }
  function updateClip() {
    // 滚轮直接移动相机，同样需要保留完整模型；包围球只在加载时计算。
    let far = Math.max(
      camera.far,
      zoomLimit.getRequiredFar() ?? 0,
      connections.getRequiredFar(camera.position),
    )
    if (imagery) {
      // 聚焦小构件时也保留地图的远裁剪范围，不改变观察中心和距离边界。
      const box = imagery.bounds
      const imageryFar =
        camera.position.distanceTo(box.getCenter(new Vector3())) +
        box.getSize(new Vector3()).length()
      if (Number.isFinite(imageryFar)) far = Math.max(far, imageryFar)
    }
    if (camera.far < far) {
      camera.far = far
      camera.updateProjectionMatrix()
    }
  }
  function invalidate() {
    // 相机阻尼、外观和标签共享同一帧调度；静止时不维持常驻渲染循环。
    if (!frame && !destroyed && contextAvailable) frame = requestAnimationFrame(render)
  }
  function render(now) {
    frame = 0
    if (destroyed || !contextAvailable) return
    const moving = motion.update(now)
    const flowing = connections.update(now, !ownerDocument.hidden && !reducedMotion?.matches)
    controls.update()
    camera.updateMatrixWorld(true)
    if (
      navigationVisible &&
      current &&
      (!lastOrientation || !camera.quaternion.equals(lastOrientation))
    ) {
      lastOrientation = camera.quaternion.clone()
      const { x, y, z, w } = lastOrientation
      onNavigation?.({ x, y, z, w })
    }
    updateClip()
    imagery?.update(camera)
    selection.render(components, appearance, (active) => {
      if (active) composer.render()
      else renderer.render(scene, camera)
    })
    connections.render(renderer, camera)
    // GIS 瓦片完成也会请求渲染；相机和标记未变时复用投影，避免重复聚合。
    if (
      current &&
      components &&
      appearance &&
      (overlayDirty ||
        !lastCameraMatrix?.equals(camera.matrixWorld) ||
        !lastProjectionMatrix?.equals(camera.projectionMatrix))
    ) {
      overlayDirty = false
      lastCameraMatrix = camera.matrixWorld.clone()
      lastProjectionMatrix = camera.projectionMatrix.clone()
      projectedOverlay = projectMarkers(
        markers,
        components,
        appearance,
        current.offset,
        camera,
        width,
        height,
      )
      if (clusterOperation) {
        const live = new Map(projectedOverlay.markers.map((marker) => [marker.id, marker]))
        if (
          [...clusterOperation.signatures].some(
            ([id, signature]) => !live.has(id) || markerSignature(live.get(id)) !== signature,
          )
        )
          cancelClusterFocus()
      }
      onOverlay(projectedOverlay)
    }
    // 完成回调在最终投影通知之后运行，界面可据实际分组决定是否回退成员列表。
    if (clusterOperation?.completed) {
      const completed = clusterOperation
      clusterOperation = undefined
      completed.onComplete()
    }
    if (moving || flowing) invalidate()
  }
  controls.addEventListener('change', invalidate)
  function resize() {
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      width = 0
      height = 0
      connections.resize(0, 0)
      return
    }
    if (rect.width === width && rect.height === height) return
    width = rect.width
    height = rect.height
    overlayDirty = true
    cancelClusterFocus()
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    zoomLimit.updateViewport(width, height)
    connections.resize(width, height)
    background.resize(width, height)
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()
  const contextLost = (event) => {
    event.preventDefault()
    contextAvailable = false
    cancelAnimationFrame(frame)
    frame = 0
    connections.pause()
    motion.cancel()
    zoom.clearPending()
    zoomLimit.clear()
    clusterOperation = undefined
    if (!destroyed) onContextLost()
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost)
  function fit(object, reset, options) {
    let box = new Box3().setFromObject(object, true)
    // 空节点无包围盒，围绕自身原点给出可操作的局部视野。
    if (box.isEmpty()) {
      const center = object.getWorldPosition(new Vector3())
      box = new Box3().setFromCenterAndSize(center, new Vector3(10, 10, 10))
    }
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.01),
      center = box.getCenter(new Vector3())
    if (reset && initialView !== undefined) {
      const view = createCameraView(camera, controls, current, initialView)
      if (view) {
        const accepted = motion.moveTo(view, options)
        if (accepted) invalidate()
        if (accepted) clusterOperation = undefined
        return accepted
      }
      viewWarning = 'initialView 不是有效的 ViewState，已回退为自动适配视角'
    }
    const input = { x: 1.15, y: 0.72, z: 1.35 }
    let direction = reset
      ? new Vector3(input.x, input.y, input.z)
      : camera.position.clone().sub(controls.target)
    if (!direction.toArray().every(Number.isFinite) || !direction.lengthSq())
      direction = new Vector3(1.15, 0.72, 1.35)
    direction.normalize()
    const fov = Math.min(
      (camera.fov * Math.PI) / 180,
      2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect),
    )
    const padding = 1.35
    const distance = (radius / Math.tan(fov / 2)) * padding
    const accepted = motion.moveTo(
      {
        position: center.clone().addScaledVector(direction, distance),
        target: center,
        near: Math.max(radius / 10000, 0.001),
        far: distance + radius * 30,
        minDistance: Math.max(radius / 1000, 0.01),
        maxDistance: distance * 10,
      },
      options,
    )
    if (accepted) invalidate()
    if (accepted) clusterOperation = undefined
    return accepted
  }
  function zoomView(method, options) {
    if (!current || destroyed || !contextAvailable) return false
    const accepted = zoom[method](options)
    if (accepted) {
      clusterOperation = undefined
      invalidate()
    }
    return accepted
  }
  return {
    setBackground(options) {
      background.set(options)
    },
    show(model, index, state, view) {
      cancelClusterFocus()
      connections.setModel(model, index)
      overlayDirty = true
      clearImagery()
      onGisStatus({ status: 'disabled', loaded: 0, failed: 0, total: 0 })
      onTerrainStatus?.({ status: 'disabled', mode: 'relative', loaded: 0, failed: 0, total: 0 })
      current?.root.removeFromParent()
      selection.select(null)
      current = model
      components = index
      appearance = state
      initialView = view
      viewWarning = undefined
      lastOrientation = undefined
      zoomLimit.clear()
      zoomLimit.clearModelBounds()
      zoomLimit.setModelBounds(model.root)
      zoomLimit.updateViewport(width, height)
      scene.add(model.root)
      renderer.renderLists.dispose()
      fit(model.root, true, { duration: 0 })
      return viewWarning
    },
    setGis(options) {
      if (destroyed) return
      if (!current || !options?.enabled) {
        clearImagery()
        onGisStatus({ status: 'disabled', loaded: 0, failed: 0, total: 0 })
        onTerrainStatus?.({
          status: 'disabled',
          mode: options?.terrain?.mode ?? 'relative',
          loaded: 0,
          failed: 0,
          total: 0,
        })
        invalidate()
        return
      }
      try {
        const opacity = options.opacity ?? 0.65
        if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
          throw new Error('地图透明度必须是 0–1 的数值')
        if (!options.imagery?.key?.trim()) throw new Error('请在宿主配置天地图 Key')
        const placement = options.placement
        const identity = JSON.stringify([
          placement.sourceCrs,
          placement.reference,
          placement.localMatrix,
          placement.ecefMatrix,
          options.imagery.key,
          placement.heightResolved,
          options.terrain?.enabled ?? false,
          options.terrain?.enabled ? (options.terrain.mode ?? 'relative') : null,
          options.terrain?.enabled ? (options.terrain.key ?? null) : null,
        ])
        // 透明度更新不重建瓦片，也不会重新消耗地图请求。
        const heightTransform = options.terrain?.enabled
          ? options.terrain.toEllipsoidHeight
          : undefined
        if (imagery && imageryIdentity === identity && terrainHeightTransform === heightTransform) {
          imagery.setOpacity(opacity)
          return
        }
        clearImagery()
        const rawBounds = new Box3()
          .setFromObject(current.root, true)
          .translate(current.offset.clone().negate())
        const plan = createImageryPlan(rawBounds, placement, current.offset)
        imagery = createImageryLayer(
          plan,
          options.imagery.key,
          opacity,
          onGisStatus,
          invalidate,
          options.terrain ? { ...options.terrain } : undefined,
          onTerrainStatus,
        )
        imageryIdentity = identity
        terrainHeightTransform = heightTransform
        scene.add(imagery.root)
        updateClip()
        invalidate()
      } catch (cause) {
        clearImagery()
        onGisStatus({
          status: 'error',
          loaded: 0,
          failed: 0,
          total: 0,
          message: cause instanceof Error ? cause.message : '地图配置无效',
        })
        onTerrainStatus?.({
          status: options.terrain?.enabled ? 'error' : 'disabled',
          mode: options.terrain?.mode ?? 'relative',
          loaded: 0,
          failed: 0,
          total: 0,
          ...(options.terrain?.enabled ? { message: '地图配置无效，无法准备 DEM' } : {}),
        })
        invalidate()
      }
    },
    setConnectionLine(value) {
      if (!current || destroyed || !contextAvailable)
        return connectionLineFailure('模型未就绪、上下文不可用或查看器已销毁')
      const result = connections.setLine(value)
      if (result.success) invalidate()
      return result
    },
    removeConnectionLine(id) {
      const removed = connections.remove(id)
      if (removed) invalidate()
      return removed
    },
    clearConnectionLines() {
      connections.clear()
      if (!destroyed) invalidate()
    },
    setMarkers(values) {
      cancelClusterFocus()
      markers = values
      overlayDirty = true
      invalidate()
    },
    cancelClusterFocus,
    focusCluster(members, radius, options, onComplete) {
      if (!current || destroyed || !contextAvailable) return false
      const view = createClusterView(
        camera,
        controls,
        current,
        members,
        radius,
        width,
        height,
        options,
      )
      if (!view) return false
      motion.cancel()
      const operation = {
        signatures: new Map(members.map((marker) => [marker.id, markerSignature(marker)])),
        onComplete,
        completed: false,
      }
      clusterOperation = operation
      const accepted = motion.moveTo(view, options, {
        onComplete: () => {
          if (clusterOperation === operation) operation.completed = true
        },
        onCancel: () => {
          if (clusterOperation === operation) clusterOperation = undefined
        },
      })
      if (!accepted) clusterOperation = undefined
      else invalidate()
      return accepted
    },
    select(object) {
      selection.select(object)
      invalidate()
    },
    focus(object, options) {
      return fit(object, false, options)
    },
    focusPoint(point, options) {
      if (!current || destroyed || !contextAvailable) return false
      const view = createPointView(camera, controls, current, point, options)
      if (!view) return false
      const accepted = motion.moveTo(view, options)
      if (accepted) clusterOperation = undefined
      if (accepted) invalidate()
      return accepted
    },
    getViewState() {
      if (!current || destroyed || !contextAvailable) return null
      return getCameraViewState(camera, controls, current.offset)
    },
    setViewState(value, options) {
      if (!current || destroyed || !contextAvailable || !validateViewState(value)) return false
      const view = createCameraView(camera, controls, current, value)
      if (!view) return false
      zoom.clearPending()
      clusterOperation = undefined
      const accepted = motion.moveTo(view, options)
      if (accepted) invalidate()
      return accepted
    },
    zoomIn: (options) => zoomView('zoomIn', options),
    zoomOut: (options) => zoomView('zoomOut', options),
    reset(options) {
      return current && !destroyed && contextAvailable ? fit(current.root, true, options) : false
    },
    setNavigationVisible(visible) {
      if (destroyed || navigationVisible === visible) return
      navigationVisible = visible
      lastOrientation = undefined
      if (visible) invalidate()
    },
    setViewDirection(direction, options) {
      if (!current || destroyed || !contextAvailable) return false
      const accepted = navigation.setViewDirection(direction, options)
      if (accepted) clusterOperation = undefined
      if (accepted) invalidate()
      return accepted
    },
    navigate(direction, options) {
      if (!current || destroyed || !contextAvailable) return false
      const accepted = navigation.navigate(direction, options)
      if (accepted) clusterOperation = undefined
      if (accepted) invalidate()
      return accepted
    },
    pick(clientX, clientY) {
      // client 坐标先换算为画布归一化坐标；隐藏及完全透明的构件不参与选择。
      if (!current) return null
      const rect = renderer.domElement.getBoundingClientRect()
      const ray = new Raycaster()
      ray.setFromCamera(
        new Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          (-(clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      )
      return (
        ray.intersectObject(current.root, true).find((hit) => {
          const id = components?.byObject.get(hit.object)
          const materials = hit.object.material
          const material = Array.isArray(materials)
            ? materials[hit.face?.materialIndex ?? 0]
            : materials
          return (
            id &&
            appearance?.get(id)?.effective.visible &&
            material?.visible &&
            material.opacity > 0
          )
        })?.object || null
      )
    },
    refresh() {
      overlayDirty = true
      invalidate()
    },
    dispose() {
      // 此处只释放视窗资源；模型与外观材质由 Vue 适配层按顺序交给各模块释放。
      destroyed = true
      clusterOperation = undefined
      projectedOverlay = undefined
      motion.cancel()
      zoom.dispose()
      zoomLimit.dispose()
      connections.dispose()
      ownerDocument.removeEventListener('visibilitychange', playbackChanged)
      reducedMotion?.removeEventListener('change', playbackChanged)
      clearImagery()
      background.dispose()
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      controls.removeEventListener('start', startInteraction)
      controls.dispose()
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      selection.dispose()
      output.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      current = undefined
      components = undefined
      appearance = undefined
    },
  }
}
