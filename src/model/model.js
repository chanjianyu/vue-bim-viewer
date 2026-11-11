import { Box3, Group, LoadingManager, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** scene 是 Loader 原始根；root 仅用于展示居中，offset 不写回模型节点数据。 */

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 非安全用途的资源指纹。双 32 位散列兼容非 HTTPS 部署，不依赖 WebCrypto。 */
export function resourceFingerprint(parts) {
  let a = 2166136261,
    b = 2246822507
  for (const bytes of parts) {
    // 长度参与散列，区分不同资源分段；包括元数据，防止映射更新后错误恢复外观。
    for (const shift of [0, 8, 16, 24]) {
      const byte = (bytes.length >>> shift) & 255
      a = Math.imul(a ^ byte, 16777619)
      b = Math.imul(b ^ byte, 3266489909)
    }
    for (const byte of bytes) {
      a = Math.imul(a ^ byte, 16777619)
      b = Math.imul(b ^ byte, 3266489909)
    }
  }
  return `resource-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

/** 几何、材质、纹理去重释放；外观克隆材质由 appearance 模块先释放。 */
export function disposeScene(root) {
  const geometries = new Set()
  const allMaterials = new Set()
  const textures = new Set()
  const images = new Set()
  root.traverse((node) => {
    if (node?.isMesh !== true) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      allMaterials.add(material)
      for (const value of Object.values(material))
        if (value?.isTexture === true) textures.add(value)
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  allMaterials.forEach((material) => material.dispose())
  textures.forEach((texture) => {
    const data = texture.source.data
    for (const image of Array.isArray(data) ? data : [data]) {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) images.add(image)
    }
    texture.dispose()
  })
  images.forEach((image) => image.close())
  root.removeFromParent()
}

async function read(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`资源读取失败（HTTP ${response.status}）：${url}`)
  if (response.headers.get('content-type')?.includes('text/html'))
    throw new Error(`资源返回了 HTML：${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

function json(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes))
}
function sourceJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 20 && view.getUint32(0, true) === 0x46546c67) {
    const length = view.getUint32(12, true)
    return json(bytes.subarray(20, 20 + length))
  }
  const value = json(bytes)
  if (!isRecord(value)) throw new Error('glTF 根节点无效')
  return value
}

/** 同一 signal 管理所有网络请求；属性映射全部结束后才返回可就绪的模型。 */
export async function loadModel(source, signal, progress) {
  const manifestUrl = new URL(source.manifestUrl, globalThis.location?.href).href
  if (!/^https?:/.test(manifestUrl)) throw new Error('Manifest 必须是 HTTP/HTTPS 地址')
  progress('正在读取模型清单')
  const manifestBytes = await read(manifestUrl, signal)
  const manifest = json(manifestBytes)
  if (!isRecord(manifest) || manifest.version !== '1.0.0' || typeof manifest.entry !== 'string')
    throw new Error('Manifest 格式无效或版本不支持')
  const modelUrl = new URL(manifest.entry, manifestUrl).href
  if (!/\.(glb|gltf)$/i.test(new URL(modelUrl).pathname))
    throw new Error('本版支持 GLB 和 glTF 模型')
  const warnings = []
  // 可选元数据失败只产生警告；取消加载仍须向上传递，不能当作缺失属性吞掉。
  const optional = async (name) => {
    const path = manifest[name]
    if (typeof path !== 'string') return new Uint8Array()
    try {
      const bytes = await read(new URL(path, manifestUrl).href, signal)
      const data = json(bytes)
      if (name === 'properties' && !isRecord(data))
        throw new Error('properties 必须是按构件名称索引的对象')
      if (name === 'hierarchy') {
        const roots = Array.isArray(data) ? data : isRecord(data) ? data.root : null
        if (!Array.isArray(roots)) throw new Error('hierarchy 必须提供 root 数组或根节点数组')
        const nodes = [...roots]
        while (nodes.length) {
          const node = nodes.pop()
          if (
            !isRecord(node) ||
            (node.name !== undefined && typeof node.name !== 'string') ||
            (node.children !== undefined && !Array.isArray(node.children))
          )
            throw new Error('hierarchy 节点格式无效')
          if (Array.isArray(node.children)) nodes.push(...node.children)
        }
      }
      return bytes
    } catch (error) {
      signal.throwIfAborted()
      warnings.push(
        `${name} 未能读取，已继续加载模型：${error instanceof Error ? error.message : String(error)}`,
      )
      return new Uint8Array()
    }
  }
  progress('正在下载模型和属性')
  const [bytes, hierarchyBytes, propertiesBytes] = await Promise.all([
    read(modelUrl, signal),
    optional('hierarchy'),
    optional('properties'),
  ])
  signal.throwIfAborted()
  // 元数据和外部资源共同参与版本计算，构件树就绪后 ID 不再随迟到请求改变。
  const sourceData = sourceJson(bytes)
  const fingerprintParts = [manifestBytes, bytes, hierarchyBytes, propertiesBytes]
  const blobUrls = []
  const manager = new LoadingManager()
  manager.onError = (url) =>
    warnings.push(`贴图加载失败：${url.startsWith('blob:') ? '内嵌贴图' : url}`)
  let gltf
  try {
    // 外部 glTF buffer/image 先经 fetch 获取，保证可取消并计入资源指纹。
    const resources = [
      ...(Array.isArray(sourceData.buffers) ? sourceData.buffers : []),
      ...(Array.isArray(sourceData.images) ? sourceData.images : []),
    ]
    const external = resources.filter(
      (item) => isRecord(item) && typeof item.uri === 'string' && !/^(data:|blob:)/i.test(item.uri),
    )
    const assetUrls = new Map()
    const downloads = new Map()
    const assets = await Promise.all(
      external.map(async (item) => {
        const url = new URL(String(item.uri), modelUrl).href
        if (!downloads.has(url)) downloads.set(url, read(url, signal))
        return {
          url,
          bytes: await downloads.get(url),
          mime:
            typeof item.mimeType === 'string'
              ? item.mimeType
              : /\.png(?:[?#]|$)/i.test(url)
                ? 'image/png'
                : /\.jpe?g(?:[?#]|$)/i.test(url)
                  ? 'image/jpeg'
                  : 'application/octet-stream',
        }
      }),
    )
    signal.throwIfAborted()
    for (const asset of assets) {
      // 指纹仍按资源条目顺序计算；同 URL 只复用下载和临时 Blob。
      fingerprintParts.push(asset.bytes)
      if (assetUrls.has(asset.url)) continue
      const blob = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }))
      blobUrls.push(blob)
      assetUrls.set(asset.url, blob)
    }
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/i.test(url)) return url
      return assetUrls.get(new URL(url, modelUrl).href) ?? url
    })
    progress('正在解析模型')
    gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, new URL('./', modelUrl).href)
    console.log('模型加载结果', gltf)
    console.log('顶层节点数组', gltf.scene.children)
    signal.throwIfAborted()
    const scene = gltf.scene
    const root = new Group()
    root.name = 'viewer-display-wrapper'
    root.add(scene)
    root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(scene, true)
    if (
      bounds.isEmpty() ||
      ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    )
      throw new Error('模型没有有效几何')
    // 只居中 wrapper，锚点查询必须扣除这个偏移，不能改写源节点。
    const offset = bounds.getCenter(new Vector3()).negate()
    root.position.copy(offset)
    root.updateMatrixWorld(true)
    let meshes = 0,
      triangles = 0
    scene.traverse((node) => {
      if (node?.isMesh !== true) return
      meshes++
      triangles +=
        (node.geometry.index?.count ?? node.geometry.getAttribute('position')?.count ?? 0) / 3
    })
    const hierarchyValue = hierarchyBytes.length ? json(hierarchyBytes) : {}
    const hierarchy = Array.isArray(hierarchyValue)
      ? hierarchyValue
      : isRecord(hierarchyValue) && Array.isArray(hierarchyValue.root)
        ? hierarchyValue.root
        : []
    const propertiesValue = propertiesBytes.length ? json(propertiesBytes) : {}
    const associations = new Map()
    for (const [object, association] of gltf.parser.associations)
      if ('isObject3D' in object) associations.set(object, association)
    let disposed = false
    return {
      root,
      scene,
      offset,
      associations,
      sourceNames: Array.isArray(sourceData.nodes)
        ? sourceData.nodes.map((node) =>
            isRecord(node) && typeof node.name === 'string' ? node.name : '',
          )
        : [],
      metadata: {
        hierarchy: hierarchy.filter(isRecord),
        properties: isRecord(propertiesValue) ? propertiesValue : {},
      },
      modelId: typeof manifest.modelId === 'string' ? manifest.modelId : manifestUrl,
      revision: resourceFingerprint(fingerprintParts),
      manifestUrl,
      label: typeof manifest.label === 'string' ? manifest.label : 'BIM 模型',
      stats: { meshes, triangles: Math.round(triangles), bytes: bytes.byteLength },
      warnings,
      dispose() {
        // 重载失败与组件卸载都可能触发清理，保持释放幂等。
        if (!disposed) {
          disposed = true
          disposeScene(root)
        }
      },
    }
  } catch (error) {
    if (gltf) disposeScene(gltf.scene)
    throw error
  } finally {
    // parseAsync 已完成资源读取，无论成功、失败或取消，都回收临时 Blob 地址。
    blobUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}
