import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

test('JavaScript Vue 组件保留六项 Props、默认值、八个事件及全部实例方法', () => {
  const source = readFileSync(new URL('../src/MineViewer.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  assert.equal(descriptor.scriptSetup.lang, undefined)
  let props, events, api
  const capture = source.slice(source.indexOf('const props ='), source.indexOf('const viewport ='))
  vm.runInNewContext(capture, {
    defineProps: (value) => (props = value),
    defineEmits: (value) => (events = value),
    Object,
    Array,
  })
  assert.deepEqual(Object.keys(props), [
    'modelSource',
    'markers',
    'initialView',
    'cameraTransition',
    'gis',
    'background',
  ])
  assert.equal(props.modelSource.required, true)
  assert.equal(props.modelSource.type, Object)
  assert.equal(props.markers.type, Array)
  assert.equal(props.markers.default().length, 0)
  assert.notEqual(props.markers.default(), props.markers.default())
  assert.equal(Object.keys(props.initialView.default()).length, 0)
  assert.notEqual(props.initialView.default(), props.initialView.default())
  assert.deepEqual(Array.from(events), [
    'model-loaded',
    'model-error',
    'component-tree-ready',
    'component-select',
    'appearance-change',
    'marker-click',
    'gis-status',
    'background-error',
  ])
  const script = compileScript(descriptor, { id: 'contract' })
  const template = compileTemplate({
    id: 'contract',
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  const apiSource = source.slice(source.indexOf('const api ='), source.indexOf('defineExpose(api)'))
  vm.runInNewContext(apiSource + '\ncapture(api)', {
    selectComponent() {},
    reload() {},
    capture: (value) => (api = value),
  })
  assert.equal(Object.keys(api).length, 17)
  assert.ok(Object.values(api).every((value) => typeof value === 'function'))
})
