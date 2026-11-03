<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { loadModel } from './model.js'
import { cloneComponent, cloneComponentTree, createComponents, sceneTree } from './components.js'
import { createAppearance } from './appearance.js'
import { createViewer } from './viewer.js'
import CameraNavigation from './navigation/CameraNavigation.vue'
import { resolveNavigation } from './navigation/view-cube.js'

const props = defineProps({
  modelSource: { type: Object, required: true },
  markers: { type: Array, default: () => [] },
  initialView: { type: Object, default: () => ({}) },
  cameraTransition: { type: Object },
  gis: { type: Object },
  background: { type: Object },
  navigation: { type: Object },
})
const emit = defineEmits([
  'model-loaded',
  'model-error',
  'component-tree-ready',
  'component-select',
  'appearance-change',
  'marker-click',
  'gis-status',
  'terrain-status',
  'background-error',
])
const viewport = ref()
const navigationReady = ref(false)
const orientation = shallowRef({ x: 0, y: 0, z: 0, w: 1 })
const navigationState = computed(() => resolveNavigation(props.navigation))
const loading = ref(false),
  error = ref(''),
  progress = ref('准备加载'),
  activeMarkerId = ref(null)
// Three 实例留在普通变量中；Vue 只响应快照、加载状态与标签布局。
const overlay = shallowRef({ markers: [], issues: [], width: 0, height: 0 })
const notices = shallowRef([])
const gisStatus = shallowRef({ status: 'disabled', loaded: 0, failed: 0, total: 0 })
let viewer
let contextAvailable = true
let model, components, appearance
let pending,
  generation = 0
watch(
  () => navigationState.value.cube,
  (visible) => viewer?.setNavigationVisible(visible),
)
const activeMarker = computed(() =>
  overlay.value.markers.find((marker) => marker.id === activeMarkerId.value && marker.visible),
)
watch(activeMarker, (value) => {
  // 绑定构件隐藏、标记删除或离开视口时，同时关闭弹窗。
  if (!value) activeMarkerId.value = null
})
watch(
  () => props.modelSource.manifestUrl,
  () => {
    void reload()
  },
)
watch(
  () => props.markers,
  (values) => viewer?.setMarkers(values),
  { deep: true },
)
watch(
  () => props.gis,
  (value) => viewer?.setGis(value),
  { deep: true, flush: 'post' },
)
watch(
  () => props.background,
  (value) => viewer?.setBackground(value),
  { deep: true },
)

/** 候选模型完全就绪才替换旧模型，避免失败重载破坏当前工作状态。 */
async function reload() {
  if (!viewer) return
  const id = ++generation
  // abort 停止网络请求，generation 防止已进入解析阶段的旧任务覆盖新场景。
  pending?.abort()
  pending = new AbortController()
  const signal = pending.signal
  loading.value = true
  error.value = ''
  activeMarkerId.value = null
  let candidate, candidateAppearance
  try {
    candidate = await loadModel(props.modelSource, signal, (text) => {
      if (id === generation) progress.value = text
    })
    if (signal.aborted || id !== generation || !viewer) {
      candidate.dispose()
      return
    }
    const index = createComponents([candidate.scene], candidate)
    candidateAppearance = createAppearance(index, (event) => {
      viewer?.refresh()
      emit('appearance-change', event)
    })
    const previous = model,
      previousAppearance = appearance
    viewer.show(candidate, index, candidateAppearance, props.initialView)
    navigationReady.value = contextAvailable
    model = candidate
    components = index
    appearance = candidateAppearance
    // 先恢复旧模型源材质并释放外观克隆，再释放几何、原材质与纹理。
    previousAppearance?.dispose()
    previous?.dispose()
    notices.value = [...candidate.warnings, ...index.warnings]
    viewer.setMarkers(props.markers)
    emit('component-tree-ready', cloneComponentTree(index.tree))
    emit('component-select', null)
    emit('model-loaded', {
      modelId: candidate.modelId,
      revision: candidate.revision,
      label: candidate.label,
      manifestUrl: candidate.manifestUrl,
      stats: { ...candidate.stats },
      warnings: [...notices.value],
    })
    // 宿主在 tree-ready 中重取新模型锚点；等 props 同步后再应用，避免套用旧模型配准。
    await nextTick()
    if (id === generation && !signal.aborted) viewer?.setGis(props.gis)
  } catch (cause) {
    candidateAppearance?.dispose()
    candidate?.dispose()
    if (signal.aborted || id !== generation) return
    pending?.abort()
    error.value = cause instanceof Error ? cause.message : String(cause)
    emit('model-error', { message: error.value })
  } finally {
    if (id === generation) loading.value = false
  }
}
const notReady = () => ({
  changedIds: [],
  unknownIds: [],
  skipped: [],
  error: '模型尚未就绪',
})
function selectComponent(id) {
  // 树点击和三维拾取都走这里，通过同一个事件让宿主同步选择状态。
  if (id && !components?.byId.has(id)) return false
  viewer?.select(id ? components?.renderObjects.get(id) || null : null)
  const node = id ? components?.byId.get(id) : null
  emit('component-select', node ? cloneComponent(node) : null)
  return Boolean(viewer && components)
}
let pointer
function pointerUp(event) {
  // 超过 5 CSS 像素视为拖拽旋转，避免松开鼠标时误选构件。
  if (
    !pointer ||
    event.button !== 0 ||
    Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5
  )
    return
  const picked = viewer?.pick(event.clientX, event.clientY)
  const id = picked && components?.byObject.get(picked)
  selectComponent(id || null)
  pointer = undefined
}
function activateMarker(marker) {
  activeMarkerId.value = activeMarkerId.value === marker.id ? null : marker.id
  emit('marker-click', marker)
}
function popupStyle(x, y) {
  const width = Math.min(300, Math.max(0, overlay.value.width - 32))
  const left = Math.max(16, Math.min(x + 24, overlay.value.width - width - 16))
  let top = Math.max(16, Math.min(y + 24, overlay.value.height - 240))
  const navigationHeight = navigationState.value.height
  const navigationWidth = navigationState.value.cube ? 150 : 44
  const creditVisible = props.gis?.enabled && gisStatus.value.loaded
  const reservedBottom = (navigationHeight ? navigationHeight + 24 : 16) + (creditVisible ? 32 : 0)
  const reservedWidth = Math.max(navigationHeight ? navigationWidth : 0, creditVisible ? 150 : 0)
  if (
    reservedWidth &&
    left + width > overlay.value.width - reservedWidth - 16 &&
    top < reservedBottom
  )
    top = reservedBottom
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(320, Math.max(40, overlay.value.height - top - 16))}px`,
  }
}

// 公开能力由 ViewerApi 约束；除高级 scene 接口外，查询均返回独立普通数据。
const api = {
  getComponentTree: () => (components ? cloneComponentTree(components.tree) : null),
  getSceneTree: () => (components ? sceneTree(components) : null),
  getSceneRoot: () => model?.scene || null,
  getComponentId: (node) => components?.byObject.get(node) || null,
  getComponent: (id) => {
    const node = components?.byId.get(id)
    return node ? cloneComponent(node) : null
  },
  getComponentAnchor: (id, anchor = 'origin') => components?.getAnchor(id, anchor) || null,
  getComponentAppearance: (id) => appearance?.get(id) || null,
  setComponentAppearance: (id, patch) => appearance?.apply([{ id, patch }]) || notReady(),
  setComponentAppearances: (updates) => appearance?.apply(updates) || notReady(),
  getAppearanceChanges: () => appearance?.changes() || null,
  applyAppearanceChanges: (value) => appearance?.importChanges(value) || notReady(),
  restoreComponent: (id) => appearance?.restore(id) || notReady(),
  restoreAllComponents: () => appearance?.restore() || notReady(),
  selectComponent,
  focusComponent: (id, options) => {
    const object = components?.renderObjects.get(id)
    return object
      ? viewer?.focus(object, { ...props.cameraTransition, ...options }) || false
      : false
  },
  resetView: (options) => viewer?.reset({ ...props.cameraTransition, ...options }) || false,
  setViewDirection: (direction, options) =>
    viewer?.setViewDirection(direction, { ...props.cameraTransition, ...options }) || false,
  reload,
}
defineExpose(api)
onMounted(() => {
  try {
    viewer = createViewer(
      viewport.value,
      (value) => {
        overlay.value = value
      },
      () => {
        contextAvailable = false
        navigationReady.value = false
        pending?.abort()
        error.value = '图形上下文已中断，请重新打开页面'
        emit('model-error', { message: error.value })
      },
      (status) => {
        gisStatus.value = status
        emit('gis-status', status)
      },
      (value) => emit('background-error', value),
      (value) => {
        orientation.value = value
      },
      (value) => emit('terrain-status', value),
    )
    viewer.setNavigationVisible(navigationState.value.cube)
    viewer.setBackground(props.background)
    void reload()
  } catch (cause) {
    error.value = `无法创建三维视窗：${cause instanceof Error ? cause.message : String(cause)}`
    emit('model-error', { message: error.value })
  }
})
onBeforeUnmount(() => {
  // 先停请求、渲染和事件监听，再释放模型；防止销毁后继续访问 GPU 或写入状态。
  generation++
  pending?.abort()
  viewer?.dispose()
  appearance?.dispose()
  model?.dispose()
  components = undefined
  appearance = undefined
  model = undefined
  viewer = undefined
})
</script>

<template>
  <section
    class="mv-viewer"
    :style="{
      '--mv-map-credit-top': `${navigationState.height ? navigationState.height + 24 : 16}px`,
    }"
    aria-label="BIM 模型查看器"
    @keydown.esc="activeMarkerId = null"
  >
    <div
      ref="viewport"
      class="mv-viewport"
      @pointerdown="pointer = { x: $event.clientX, y: $event.clientY }"
      @pointerup="pointerUp"
    />
    <div class="mv-markers">
      <button
        v-for="marker in overlay.markers.filter((item) => item.visible)"
        :key="marker.id"
        class="mv-marker"
        :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
        :aria-label="marker.label"
        :aria-pressed="activeMarkerId === marker.id"
        @click.stop="activateMarker(marker)"
      >
        <slot name="marker" :marker="marker" :selected="activeMarkerId === marker.id"
          ><span class="mv-dot" />{{ marker.label }}</slot
        >
      </button>
      <article
        v-if="activeMarker"
        role="dialog"
        :aria-label="activeMarker.label"
        class="mv-popup"
        :style="popupStyle(activeMarker.x, activeMarker.y)"
      >
        <slot
          name="marker-popup"
          :marker="activeMarker"
          :close="
            () => {
              activeMarkerId = null
            }
          "
        >
          <header>
            <strong>{{ activeMarker.label }}</strong
            ><button aria-label="关闭标记信息" @click="activeMarkerId = null">关闭</button>
          </header>
          <p>{{ activeMarker.modelPosition }}</p>
        </slot>
      </article>
    </div>
    <div v-if="loading" class="mv-status" role="status">{{ progress }}…</div>
    <CameraNavigation
      :options="navigation"
      :orientation="orientation"
      :disabled="!navigationReady"
      @home="api.resetView()"
      @navigate="viewer?.navigate($event, props.cameraTransition)"
    />
    <a
      v-if="gis?.enabled && gisStatus.loaded"
      class="mv-map-credit"
      href="https://www.tianditu.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
      >影像 © 天地图</a
    >
    <div v-if="error" class="mv-error" role="alert">
      <p>{{ error }}</p>
      <button :disabled="loading" @click="reload">{{ loading ? '正在重试…' : '重试加载' }}</button>
    </div>
    <details
      v-if="!error && !loading && (notices.length || overlay.issues.length)"
      class="mv-notices"
    >
      <summary>加载提示（{{ notices.length + overlay.issues.length }}）</summary>
      <ul>
        <li v-for="notice in [...notices, ...overlay.issues]" :key="notice">{{ notice }}</li>
      </ul>
    </details>
  </section>
</template>
