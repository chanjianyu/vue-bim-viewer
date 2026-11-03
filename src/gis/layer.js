import { DoubleSide, Group, MeshBasicMaterial } from 'three'
import {
  Tile,
  TileImageLoader,
  TileLoadingManager,
  TileMap,
  TileMapLoader,
  TileMesh,
} from 'three-tile'
import { createTileGeometry } from './projection.js'
import { createMapRequests } from './requests.js'
import { createTerrainSource } from './terrain-source.js'
import { createTerrainGeometry } from './terrain-geometry.js'

// three-tile 默认使用全局 manager；每个 Viewer 单独持有，避免回调互相覆盖。
class ImageryLoader extends TileMapLoader {
  get manager() {
    return (this.localManager ??= new TileLoadingManager())
  }

  async updateMaterial(params, mesh) {
    // 原生 load() 在图片失败时不会释放已创建的材质，保留引用用于失败清理。
    let material
    const request = { ...params, source: this.imgSource[0] }
    request.created = (value) => (material = value)
    try {
      material = await this.images.load(request)
      if (this.stopped) material.dispose()
      else {
        material.opacity = this.imgSource[0].opacity
        material.map.needsUpdate = true
        mesh.syncMaterials([material])
      }
    } catch {
      material?.dispose()
      // 不传播 three-tile/浏览器异常中的 URL 和天地图 Key。
      throw new Error('影像加载失败，请检查天地图 Key、网络、跨域或服务权限')
    }
    return true
  }

  async updateGeometry(params, mesh) {
    if (!this.stopped)
      mesh.setGeometry(createTileGeometry({ ...params, zoom: params.z }, this.project))
    return true
  }
}

class ImageryImages extends TileImageLoader {
  createMaterial(params) {
    const material = super.createMaterial(params)
    params.created(material)
    return material
  }
}

function releaseMesh(mesh) {
  mesh.removeFromParent()
  mesh.geometry.dispose()
  // 原生影像材质的 dispose 监听器负责释放纹理，避免重复释放。
  mesh.material.forEach((material) => material.dispose())
  mesh.material.length = 0
}

// ponytail: 本期为固定矿区，不启用全球四叉树 LOD；未来无限漫游再更换根节点策略。
class ImageryRoot extends Tile {
  addEventListener(type, listener) {
    ;(this.listeners ??= []).push([type, listener])
    super.addEventListener(type, listener)
  }

  constructor(plan, onStatus, invalidate, terrainOptions, onTerrainStatus) {
    super()
    this.plan = plan
    this.onStatus = onStatus
    this.invalidate = invalidate
    this.content = new Group()
    this.add(this.content)
    this.cursor = this.loaded = this.failed = 0
    this.pending = new Set()
    this.stopped = false
    this.terrainOptions = terrainOptions
    this.onTerrainStatus = onTerrainStatus
    this.terrainLoaded = this.terrainFailed = 0
    this.terrainMeshes = new Map()
  }

  emitTerrain(message = this.terrainMessage) {
    if (this.stopped) return
    const enabled = this.terrainOptions?.enabled
    const total = enabled ? this.plan.tiles.length : 0
    const done = this.terrainLoaded + this.terrainFailed === total
    this.onTerrainStatus?.({
      status: !enabled
        ? 'disabled'
        : done
          ? this.terrainFailed
            ? this.terrainLoaded
              ? 'partial'
              : 'error'
            : 'ready'
          : 'loading',
      mode: this.terrainOptions?.mode === 'absolute' ? 'absolute' : 'relative',
      loaded: this.terrainLoaded,
      failed: this.terrainFailed,
      total,
      ...(message || this.terrainFailed
        ? {
            message:
              message ||
              'DEM 加载或采样失败，对应瓦片保留平面影像；请检查天地图权限、覆盖范围和网络',
          }
        : {}),
    })
  }

  prepareTerrain(tile, mesh) {
    if (!this.terrain || this.stopped) return
    void this.terrain
      .prepare(tile)
      .then((heights) => {
        if (this.stopped) return
        if (mesh.parent) {
          const entry = createTerrainGeometry(
            tile,
            this.plan,
            heights,
            this.terrainOptions.mode === 'absolute',
          )
          const id = `${tile.x}/${tile.y}`
          this.terrainMeshes.set(id, entry)
          mesh.setGeometry(entry.geometry)
          mesh.syncGroups()
          const neighbors = [
            [tile.x, tile.y - 1],
            [tile.x + 1, tile.y],
            [tile.x, tile.y + 1],
            [tile.x - 1, tile.y],
          ].map(([x, y]) => this.terrainMeshes.get(`${x}/${y}`))
          entry.updateSkirts(neighbors.map((neighbor, side) => neighbor?.edges[(side + 2) % 4]))
          this.plan.bounds.union(entry.geometry.boundingBox)
          neighbors.forEach((neighbor, side) => {
            if (!neighbor) return
            // 邻块完成后同步双方边缘；其他已知邻接关系由几何体保留。
            const ownSide = (side + 2) % 4
            neighbor.updateSkirts({ [ownSide]: entry.edges[side] })
            this.plan.bounds.union(neighbor.geometry.boundingBox)
          })
        }
        this.terrainLoaded++
        this.emitTerrain()
        this.invalidate()
      })
      .catch((cause) => {
        if (this.stopped) return
        this.terrainFailed++
        const known = {
          'DEM 基准高程获取失败，整层保持平面影像': 'DEM 基准高程获取失败，整层保持平面影像',
          'DEM 采样点缺少有效高程': '天地图 DEM 在部分采样位置缺测，对应瓦片保留平面影像',
          'DEM 高程基准转换失败': 'DEM 高程基准转换失败，对应瓦片保留平面影像',
          'DEM 高程转换必须返回有限的椭球高':
            'DEM 高程转换必须返回有限的椭球高，对应瓦片保留平面影像',
        }
        this.terrainMessage = known[cause?.message] || this.terrainMessage
        this.emitTerrain(this.terrainMessage)
        this.invalidate()
      })
  }

  emit() {
    if (this.stopped) return
    const total = this.plan.tiles.length
    const done = this.loaded + this.failed === total
    this.onStatus({
      status: done ? (this.failed ? (this.loaded ? 'partial' : 'error') : 'ready') : 'loading',
      loaded: this.loaded,
      failed: this.failed,
      total,
      ...(this.failed ? { message: '影像加载失败，请检查天地图 Key、网络、跨域或服务权限' } : {}),
    })
  }

  update({ loader }) {
    if (this.stopped) return
    while (this.pending.size < loader.maxThreads && this.cursor < this.plan.tiles.length) {
      const tile = this.plan.tiles[this.cursor++]
      const mesh = new TileMesh()
      this.pending.add(mesh)
      void loader
        .update({ x: tile.x, y: tile.y, z: tile.zoom }, mesh)
        .then(() => {
          if (!this.stopped) {
            this.content.add(mesh)
            this.loaded++
          }
        })
        .catch(() => {
          if (!this.stopped) this.failed++
        })
        .finally(() => {
          this.pending.delete(mesh)
          if (this.stopped || !mesh.parent) releaseMesh(mesh)
          if (!this.stopped) {
            this.prepareTerrain(tile, mesh)
            this.emit()
            this.invalidate()
          }
        })
    }
  }

  reload(dispose = true) {
    // TileMap 构造时会标记 source 变化；固定影像只由整个 layer 替换。
    if (!dispose) return this
    this.content.children.slice().forEach(releaseMesh)
    return this
  }
}

/** 影像与材质交给 three-tile；模型坐标适配、有限调度和状态归本实例所有。 */
export function createImageryLayer(
  plan,
  key,
  opacity = 0.65,
  onStatus,
  invalidate,
  terrainOptions,
  onTerrainStatus,
) {
  const requests = createMapRequests()
  const loader = new ImageryLoader()
  loader.project = plan.project
  loader.images = new ImageryImages()
  loader.images.loader.manager = loader.manager
  // three-tile 继续负责 URL、纹理和材质；替换其图像传输以支持共享预算和 AbortSignal。
  loader.images.loader.loadAsync = (url) =>
    requests.run(async (signal) => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error('影像请求失败')
      const bitmap = await createImageBitmap(await response.blob(), {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      if (requests.stopped || signal.aborted) {
        bitmap.close()
        throw new Error('影像请求已取消')
      }
      return bitmap
    })
  loader.images.material = new MeshBasicMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    toneMapped: false,
  })
  const tileRoot = new ImageryRoot(plan, onStatus, invalidate, terrainOptions, onTerrainStatus)
  if (terrainOptions?.enabled) {
    try {
      if (!['relative', 'absolute'].includes(terrainOptions.mode ?? 'relative'))
        throw new Error('DEM 模式必须为 relative 或 absolute')
      const terrainKey = terrainOptions.key ?? key
      if (!terrainKey?.trim()) throw new Error('请配置天地图 DEM Key')
      tileRoot.terrain = createTerrainSource(plan, terrainOptions, terrainKey, requests)
    } catch (cause) {
      tileRoot.terrainFailed = plan.tiles.length
      tileRoot.emitTerrain(cause.message)
    }
  }
  const root = new Group()
  root.name = 'GIS imagery'
  let map
  // plugin 的 GeoJSON 模块会在导入时创建 OffscreenCanvas，仅启用地图后才导入。
  // 保持 SDK 的 ESM/CJS 入口可以在 Node/SSR 中安全导入。
  void import('three-tile/plugin')
    .then(({ TDTSource }) => {
      if (tileRoot.stopped) return
      const source = new TDTSource({
        token: key,
        style: 'img_w',
        minLevel: plan.tiles[0].zoom,
        maxLevel: plan.tiles[0].zoom,
        opacity,
        transparent: true,
      })
      map = TileMap.create({ loader, rootTile: tileRoot, imgSource: source })
      map.autoUpdate = false
      map.updateInterval = 0
      map.maxThreads = 6
      // 默认根节点是全球 Mercator 米；这里网格已逐顶点转为展示空间。
      tileRoot.scale.set(1, 1, 1)
      tileRoot.updateMatrixWorld(true)
      root.add(map)
      invalidate()
    })
    .catch(() => {
      if (tileRoot.stopped) return
      tileRoot.failed = plan.tiles.length
      tileRoot.emit()
      if (terrainOptions?.enabled && !tileRoot.terrainFailed) {
        tileRoot.terrainFailed = plan.tiles.length
        tileRoot.emitTerrain('地图初始化失败，无法准备 DEM')
      }
      invalidate()
    })
  tileRoot.emit()
  if (!tileRoot.terrainFailed) tileRoot.emitTerrain()
  return {
    root,
    bounds: plan.bounds,
    update(camera) {
      if (!tileRoot.stopped) map?.update(camera)
    },
    setOpacity(value) {
      if (tileRoot.stopped) return
      opacity = value
      if (map) map.imgSource[0].opacity = value
      tileRoot.content.children.forEach((mesh) => {
        mesh.material.forEach((material) => (material.opacity = value))
      })
      invalidate()
    },
    dispose() {
      if (tileRoot.stopped) return
      tileRoot.stopped = loader.stopped = true
      requests.dispose()
      tileRoot.terrain?.dispose()
      tileRoot.terrainMeshes.clear()
      root.removeFromParent()
      map?.dispose()
      tileRoot.listeners?.forEach(([type, listener]) =>
        tileRoot.removeEventListener(type, listener),
      )
      tileRoot.listeners = []
      loader.images.material.dispose()
      loader._errorMaterial.dispose()
      for (const name of ['onStart', 'onLoad', 'onProgress', 'onError', 'onParseEnd'])
        loader.manager[name] = undefined
      root.clear()
    },
  }
}
