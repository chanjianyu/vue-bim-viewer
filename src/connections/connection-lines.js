import { Box3, Group, Scene, Sphere, Vector4 } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { createConnectionArrows } from './connection-arrows.js'
import { createConnectionFlow } from './connection-flow.js'
import { connectionLineFailure, resolveConnectionLine } from './connection-line-data.js'

/** 每 Viewer 独立的覆盖场景；不持有模型资源，不自行调度渲染。 */
export function createConnectionLines() {
  const scene = new Scene(),
    entries = new Map()
  const viewport = new Vector4(),
    scissor = new Vector4()
  let model,
    components,
    disposed = false,
    width = 0,
    height = 0
  function release(entry) {
    entry.root.removeFromParent()
    entry.line.geometry.dispose()
    entry.line.material.dispose()
    entry.arrows?.dispose()
    entry.flow?.dispose()
  }
  function clear() {
    entries.forEach(release)
    entries.clear()
  }
  function pause() {
    entries.forEach((entry) => {
      entry.lastFrame = undefined
    })
  }
  return {
    setModel(nextModel, index) {
      clear()
      model = nextModel
      components = index
    },
    setLine(value) {
      if (disposed || !model || !components)
        return connectionLineFailure('模型未就绪或查看器已销毁')
      const resolved = resolveConnectionLine(value, components, model.offset)
      if (resolved.result) return resolved.result
      const { options, points, path } = resolved
      let geometry, material, arrows, flow
      try {
        geometry = new LineGeometry()
        geometry.setPositions(points.flatMap((point) => point.toArray()))
        material = new LineMaterial({
          color: options.color,
          linewidth: options.width,
          worldUnits: false,
          opacity: options.opacity,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        })
        const line = new Line2(geometry, material)
        line.frustumCulled = false
        arrows = options.showArrows ? createConnectionArrows(points, options) : undefined
        flow = options.flow.enabled ? createConnectionFlow(points, path, options) : undefined
        const root = new Group()
        root.visible = options.visible && options.opacity > 0
        root.add(line)
        if (arrows) root.add(arrows.mesh)
        if (flow) root.add(flow.mesh)
        const sphere = new Box3().setFromPoints(points).getBoundingSphere(new Sphere())
        if (!Number.isFinite(sphere.radius)) throw new Error('连接线范围超出有效数值')
        const previous = entries.get(options.id)
        if (previous) release(previous)
        entries.set(options.id, {
          root,
          line,
          arrows,
          flow,
          sphere,
          duration: options.flow.duration,
          elapsed: 0,
          lastFrame: undefined,
        })
        scene.add(root)
        return { success: true, unknownIds: [], invalidAnchorIds: [] }
      } catch (error) {
        geometry?.dispose()
        material?.dispose()
        arrows?.dispose()
        flow?.dispose()
        return connectionLineFailure(error instanceof Error ? error.message : '连接线创建失败')
      }
    },
    remove(id) {
      const entry = typeof id === 'string' && id.trim() ? entries.get(id) : undefined
      if (!entry) return false
      release(entry)
      entries.delete(id)
      return true
    },
    clear,
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      if (width <= 0 || height <= 0) pause()
    },
    pause,
    update(now, canAnimate) {
      let animating = false
      for (const entry of entries.values()) {
        const active =
          !disposed &&
          canAnimate &&
          width > 0 &&
          height > 0 &&
          entry.root.visible &&
          entry.flow &&
          Number.isFinite(now)
        if (!active) {
          entry.lastFrame = undefined
          continue
        }
        if (entry.lastFrame !== undefined) {
          const delta = Math.max(0, now - entry.lastFrame)
          entry.elapsed = (entry.elapsed + (delta % entry.duration)) % entry.duration
        }
        entry.lastFrame = now
        animating = true
      }
      return animating
    },
    getRequiredFar(position) {
      let far = 0
      for (const { root, sphere } of entries.values()) {
        if (!root.visible) continue
        const required =
          position.distanceTo(sphere.center) + sphere.radius + Math.max(sphere.radius * 0.01, 0.001)
        if (Number.isFinite(required)) far = Math.max(far, required)
      }
      return far
    },
    render(renderer, camera) {
      if (
        disposed ||
        width <= 0 ||
        height <= 0 ||
        ![...entries.values()].some((entry) => entry.root.visible)
      )
        return
      const autoClear = renderer.autoClear
      const target = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace(),
        mip = renderer.getActiveMipmapLevel()
      const scissorTest = renderer.getScissorTest()
      renderer.getViewport(viewport)
      renderer.getScissor(scissor)
      try {
        renderer.autoClear = false
        renderer.setRenderTarget(null)
        renderer.setViewport(0, 0, width, height)
        renderer.setScissorTest(false)
        entries.forEach(({ root, arrows, flow, elapsed }) => {
          if (!root.visible) return
          arrows?.update(camera, width, height)
          flow?.update(elapsed, camera, width, height)
        })
        renderer.render(scene, camera)
      } finally {
        renderer.setRenderTarget(target, face, mip)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
        renderer.setScissorTest(scissorTest)
        renderer.autoClear = autoClear
      }
    },
    dispose() {
      clear()
      model = undefined
      components = undefined
      disposed = true
    },
  }
}
