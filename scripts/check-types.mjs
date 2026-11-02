import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 对独立声明执行真实消费检查；运行源码不参与 TypeScript 编译。
const root = new URL('../', import.meta.url)
const project = new URL('.cache/type-consumer/', root)
await mkdir(project, { recursive: true })
await writeFile(
  new URL('tsconfig.json', project),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: [],
      paths: {
        '@caojinyu111/vue-bim-viewer': ['../../types/index.d.ts'],
      },
    },
    include: ['Consumer.vue'],
  }),
)
const source = `<script setup lang="ts">
import { shallowRef } from 'vue'
import { MineViewer, createGisPlacement, flattenComponentTree } from '@caojinyu111/vue-bim-viewer'
import type {
  ViewerApi, ComponentTree, ComponentNode, ModelInfo, AppearanceEvent, Marker,
  GisStatus, GisOptions, ModelSource, InitialView, CameraTransitionOptions, BackgroundOptions,
} from '@caojinyu111/vue-bim-viewer'
const source: ModelSource = { manifestUrl: '/models/manifest.json' }
const initialView: InitialView = { direction: { x: 1, y: 1, z: 1 }, fitPadding: 1.35 }
const transition: CameraTransitionOptions = { duration: 0 }
const background: BackgroundOptions = { color: '#123456' }
const markers: Marker[] = [{ id: 'm', label: '井口', position: { type: 'model', x: 0, y: 0, z: 0 } }]
const gis = shallowRef<GisOptions>()
const viewer = shallowRef<InstanceType<typeof MineViewer> | null>(null)
function methods(api: ViewerApi, tree: ComponentTree) {
  const nodes: ComponentNode[] = flattenComponentTree(tree)
  api.getComponentTree(); api.getSceneTree()
  const root = api.getSceneRoot()
  if (root) api.getComponentId(root)
  api.getComponent('id'); api.getComponentAnchor('id', 'center'); api.getComponentAppearance('id')
  api.setComponentAppearance('id', { opacity: 0.5 })
  api.setComponentAppearances([{ id: 'id', patch: { color: null } }])
  api.applyAppearanceChanges(api.getAppearanceChanges())
  api.restoreComponent('id'); api.restoreAllComponents(); api.selectComponent(null)
  api.focusComponent('id', transition); api.resetView(); void api.reload()
  return nodes
}
function ready(tree: ComponentTree) { if (viewer.value) methods(viewer.value, tree) }
function loaded(info: ModelInfo) { info.stats.meshes.toFixed() }
function selected(node: ComponentNode | null) { node?.id.toUpperCase() }
function changed(event: AppearanceEvent) { event.result.changedIds.join(',') }
function clicked(marker: Marker) { marker.label.toUpperCase() }
function status(value: GisStatus) { value.loaded.toFixed() }
function error(value: { message: string }) { value.message.toUpperCase() }
const placement = createGisPlacement({
  sourceCrs: 'EPSG:4326',
  controlPoints: [
    { model: { x: 0, y: 0, z: 0 }, map: { longitude: 123, latitude: 41 } },
    { model: { x: 100, y: 0, z: 0 }, map: { longitude: 123.001, latitude: 41 } },
    { model: { x: 0, y: 0, z: -100 }, map: { longitude: 123, latitude: 41.001 } },
  ],
})
placement.toGeographic({ x: 0, y: 0, z: 0 })
</script>
<template>
  <MineViewer ref="viewer" :model-source="source" :markers="markers" :initial-view="initialView"
    :camera-transition="transition" :background="background" :gis="gis"
    @component-tree-ready="ready" @model-loaded="loaded" @component-select="selected"
    @appearance-change="changed" @marker-click="clicked" @gis-status="status"
    @model-error="error" @background-error="error">
    <template #marker="{ marker, selected }">{{ marker.modelPosition.x.toFixed() }} {{ selected.valueOf() }}</template>
    <template #marker-popup="{ marker, close }"><button @click="close">{{ marker.label }}</button></template>
  </MineViewer>
</template>
`
function check() {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('node_modules/vue-tsc/bin/vue-tsc.js', root)),
      '-p',
      fileURLToPath(project),
    ],
    { encoding: 'utf8' },
  )
  if (result.error) throw result.error
  return result
}
await writeFile(new URL('Consumer.vue', project), source)
const valid = check()
assert.equal(valid.status, 0, valid.stdout + valid.stderr)
const invalid = source
  .replace(':model-source="source"', ':model-source="42"')
  .replace('@model-loaded="loaded"', '@model-loaded="(value: number) => value.toFixed()"')
  .replace('marker.modelPosition.x.toFixed()', 'marker.missingProperty')
  .replace(
    'if (viewer.value) methods(viewer.value, tree)',
    'if (viewer.value) { methods(viewer.value, tree); viewer.value.notAnApiMethod() }',
  )
  .replace("api.restoreComponent('id')", 'api.restoreComponent()')
  .replace("sourceCrs: 'EPSG:4326'", "sourceCrs: 'EPSG:9999'")
await writeFile(new URL('Consumer.vue', project), invalid)
try {
  const rejected = check()
  const diagnostics = rejected.stdout + rejected.stderr
  assert.notEqual(rejected.status, 0, '非法消费示例必须被拒绝')
  for (const evidence of [
    'ModelSource',
    'ModelInfo',
    'missingProperty',
    'notAnApiMethod',
    'Expected 1 arguments',
    'EPSG:9999',
  ]) {
    assert.ok(diagnostics.includes(evidence), `缺少类型诊断 ${evidence}:\n${diagnostics}`)
  }
} finally {
  await writeFile(new URL('Consumer.vue', project), source)
}
console.log('公开声明检查通过：合法消费及 Props / 事件 / 插槽 / 方法 / GIS 错误输入。')
