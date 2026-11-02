import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry } from 'three'
import { loadModel, resourceFingerprint } from '../src/model.js'

function fixture(uri = './positions.bin', extraBuffers = []) {
  const geometry = new BoxGeometry(2, 2, 2).toNonIndexed()
  const positions = geometry.getAttribute('position').array.slice()
  geometry.dispose()
  const binary = Buffer.from(positions.buffer)
  const buffers = [uri, ...extraBuffers].map((uri) => ({ uri, byteLength: binary.length }))
  return {
    binary,
    manifest: { version: '1.0.0', entry: './models/model.gltf', modelId: 'fixture' },
    gltf: {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        { primitives: buffers.map((_, i) => ({ attributes: { POSITION: i }, material: 0 })) },
      ],
      materials: [{ pbrMetallicRoughness: { metallicFactor: 0 } }],
      buffers,
      bufferViews: buffers.map((_, buffer) => ({ buffer, byteLength: binary.length })),
      accessors: buffers.map((_, bufferView) => ({
        bufferView,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [-1, -1, -1],
        max: [1, 1, 1],
      })),
    },
  }
}

function globalStub(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  })
}

// 保留真实 GLTFLoader/FileLoader，仅替换网络和 Node 缺少的浏览器接口。
function network(t, data, options = {}) {
  if (!globalThis.ProgressEvent)
    globalStub(
      t,
      'ProgressEvent',
      class extends Event {
        constructor(type, options) {
          super(type)
          Object.assign(this, options)
        }
      },
    )
  const originalFetch = globalThis.fetch
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL
  const calls = [],
    managed = [],
    created = [],
    live = new Set()
  const controller = new AbortController()
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = create(blob)
    created.push(url)
    live.add(url)
    return url
  })
  t.mock.method(URL, 'revokeObjectURL', (url) => {
    live.delete(url)
    revoke(url)
  })
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (init?.cache === 'no-store') {
      managed.push(url)
      assert.equal(init.signal, controller.signal)
    }
    ;(init?.signal ?? input.signal)?.throwIfAborted()
    if (/^(blob:|data:)/i.test(url)) {
      const response = await originalFetch(input, init)
      if (options.abortParse) controller.abort()
      return response
    }
    calls.push(url)
    if (url.endsWith('/manifest.json')) return Response.json(data.manifest)
    if (url.endsWith('/model.gltf')) return Response.json(data.gltf)
    if (options.fail) return new Response('', { status: 500 })
    if (options.abortDownload) {
      controller.abort()
      controller.signal.throwIfAborted()
    }
    if (options.abortAfterDownload) controller.abort()
    return new Response(url.includes('.png') ? data.image : data.binary)
  })
  t.after(() => {
    for (const url of live) revoke(url)
  })
  const load = () =>
    loadModel({ manifestUrl: 'https://example.com/manifest.json' }, controller.signal, () => {})
  return { calls, managed, created, live, controller, load }
}

function firstMesh(model) {
  let mesh
  model.scene.traverse((node) => {
    if (!mesh && node.isMesh) mesh = node
  })
  return mesh
}

for (const uri of [
  'positions.bin',
  './positions.bin',
  '../positions.bin',
  './a/../positions.bin?v=1',
]) {
  test(`glTF ${uri} 的预下载和真实 Loader 共享一次下载`, async (t) => {
    const data = fixture(uri)
    const { calls, created, live, load } = network(t, data)
    const model = await load()
    t.after(() => model.dispose())
    assert.deepEqual(calls, [
      'https://example.com/manifest.json',
      'https://example.com/models/model.gltf',
      new URL(uri, 'https://example.com/models/model.gltf').href,
    ])
    assert.equal(created.length, 1)
    assert.equal(live.size, 0)
    assert.equal(firstMesh(model).geometry.getAttribute('position').getX(0), 1)
  })
}

test('别名只下载并创建一个 Blob，查询参数区分资源，指纹保留条目顺序', async (t) => {
  const data = fixture('./positions.bin', ['a/../positions.bin', 'positions.bin?v=2'])
  const { calls, created, live, load } = network(t, data)
  const model = await load()
  t.after(() => model.dispose())
  assert.equal(calls.filter((url) => url.endsWith('/positions.bin')).length, 1)
  assert.equal(calls.filter((url) => url.endsWith('/positions.bin?v=2')).length, 1)
  assert.equal(created.length, 2)
  assert.equal(live.size, 0)
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
  assert.equal(
    model.revision,
    resourceFingerprint([
      encode(data.manifest),
      encode(data.gltf),
      new Uint8Array(),
      new Uint8Array(),
      data.binary,
      data.binary,
      data.binary,
    ]),
  )
})

test('连续加载重新读取外部字节，主文件不变时几何和 revision 仍更新', async (t) => {
  const data = fixture()
  const { calls, load } = network(t, data)
  const first = await load()
  t.after(() => first.dispose())
  const positions = new Float32Array(
    data.binary.buffer,
    data.binary.byteOffset,
    data.binary.length / 4,
  )
  for (let i = 0; i < positions.length; i += 3) positions[i] += 100
  const second = await load()
  t.after(() => second.dispose())
  assert.notEqual(first.revision, second.revision)
  assert.equal(firstMesh(second).geometry.getAttribute('position').getX(0), 101)
  assert.equal(calls.filter((url) => url.endsWith('/positions.bin')).length, 2)
})

for (const options of [{ fail: true }, { abortDownload: true }, { abortParse: true }]) {
  test(`下载或解析失败、取消后释放 Blob：${JSON.stringify(options)}`, async (t) => {
    const { load, created, live } = network(t, fixture('positions.bin'), options)
    await assert.rejects(load, options.fail ? /HTTP 500/ : { name: 'AbortError' })
    assert.equal(created.length, options.abortParse ? 1 : 0)
    assert.equal(live.size, 0)
  })
}

test('下载完成时取消，不进入 Loader 解析且释放所有临时资源', async (t) => {
  const { load, created, live } = network(t, fixture('positions.bin'), { abortAfterDownload: true })
  await assert.rejects(load, { name: 'AbortError' })
  assert.equal(created.length, 0)
  assert.equal(live.size, 0)
})

test('真实 Loader 解析失败后释放已创建的 Blob', async (t) => {
  const data = fixture('positions.bin')
  data.gltf.accessors[0].componentType = 999
  const { load, created, live } = network(t, data)
  await assert.rejects(load)
  assert.equal(created.length, 1)
  assert.equal(live.size, 0)
})

test('外部图片别名复用 HTTP 下载和 Blob，真实 Loader 得到两张贴图', async (t) => {
  const data = fixture('positions.bin')
  data.image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
    'base64',
  )
  data.gltf.images = [{ uri: './texture.png' }, { uri: 'nested/../texture.png' }]
  data.gltf.textures = [{ source: 0 }, { source: 1 }]
  data.gltf.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 }
  data.gltf.materials[0].emissiveTexture = { index: 1 }
  globalStub(t, 'self', { URL })
  globalStub(t, 'createImageBitmap', async (blob) => {
    assert.equal(blob.type, 'image/png')
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), data.image)
    return { width: 1, height: 1 }
  })
  const { calls, created, live, load } = network(t, data)
  const model = await load()
  t.after(() => model.dispose())
  const material = firstMesh(model).material
  assert.equal(material.map.image.width, 1)
  assert.equal(material.emissiveMap.image.width, 1)
  assert.equal(calls.filter((url) => url.endsWith('/texture.png')).length, 1)
  assert.equal(created.length, 2)
  assert.equal(live.size, 0)
  assert.deepEqual(model.warnings, [])
})

for (const protocol of ['data', 'blob']) {
  test(`${protocol}: 资源直接交给 Loader，不预下载或再创建 Blob`, async (t) => {
    const data = fixture()
    const uri =
      protocol === 'data'
        ? `data:application/octet-stream;base64,${data.binary.toString('base64')}`
        : URL.createObjectURL(new Blob([data.binary]))
    if (protocol === 'blob') t.after(() => URL.revokeObjectURL(uri))
    data.gltf.buffers[0].uri = uri
    const { managed, created, load } = network(t, data)
    const model = await load()
    t.after(() => model.dispose())
    assert.equal(managed.length, 2)
    assert.equal(created.length, 0)
    assert.equal(firstMesh(model).geometry.getAttribute('position').getX(0), 1)
  })
}
