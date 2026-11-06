<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import SvgIcon from '../SvgIcon.vue'
import componentTreeIcon from '../assets/svg/component-tree.svg?raw'
import closeIcon from '../assets/svg/close.svg?raw'
import searchIcon from '../assets/svg/search.svg?raw'
import chevronRightIcon from '../assets/svg/chevron-right.svg?raw'
import componentIcon from '../assets/svg/component.svg?raw'
import componentSolidIcon from '../assets/svg/component-solid.svg?raw'
import { indexTree, searchTree, visibilityStates, visibleRows } from './tree-state.js'

const props = defineProps({
  enabled: { type: Boolean, default: true },
  tree: { type: Object, default: null },
  selectedId: { type: String, default: null },
  selectionRevision: { type: Number, default: 0 },
  appearanceRevision: { type: Number, default: 0 },
  getAppearance: { type: Function, required: true },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'visibility', 'translucency'])
const panelId = useId()
const open = ref(false),
  query = ref('')
const trigger = ref(),
  container = ref(),
  panel = ref(),
  searchInput = ref(),
  list = ref()
const position = shallowRef({ left: 16, top: 16 })
let drag = null,
  resizeObserver
const expanded = shallowRef(new Set()),
  searchExpanded = shallowRef(new Set())
const rowElements = new Map()
const index = computed(() => indexTree(props.tree))
const search = computed(() => searchTree(index.value, query.value))
const currentExpanded = computed(() => (search.value ? searchExpanded.value : expanded.value))
const rows = computed(() => visibleRows(index.value, currentExpanded.value, search.value))
const visibility = computed(() => {
  void props.appearanceRevision
  return visibilityStates(index.value, props.getAppearance)
})
const translucent = computed(() => {
  void props.appearanceRevision
  return new Map(
    index.value.nodes.map((node) => [
      node.id,
      props.getAppearance(node.id)?.effective.translucent === true,
    ]),
  )
})
const selected = computed(() => index.value.byId.get(props.selectedId))
const message = computed(() => {
  if (selected.value && search.value && !search.value.included.has(props.selectedId))
    return '选中构件不在搜索结果中'
  if (selected.value && !selected.value.bounds) return '选中构件没有可定位几何'
  return ''
})

watch(
  () => props.tree,
  () => {
    query.value = ''
    expanded.value = new Set(index.value.roots.map((node) => node.id))
    searchExpanded.value = new Set()
  },
  { immediate: true },
)
watch(search, (value) => {
  searchExpanded.value = new Set(value?.expanded)
})
watch(
  () => props.enabled,
  (enabled) => {
    if (!enabled) {
      stopDrag()
      open.value = false
    }
  },
)
watch(
  [container, open],
  ([element, isOpen]) => {
    stopDrag()
    resizeObserver?.disconnect()
    if (!element || !isOpen) return
    resizeObserver = new ResizeObserver(() => {
      stopDrag()
      constrainPosition()
    })
    resizeObserver.observe(element)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  stopDrag()
  resizeObserver?.disconnect()
})
watch(
  [() => props.selectedId, () => props.selectionRevision, open],
  async () => {
    if (!open.value || !selected.value) return
    if (search.value && !search.value.included.has(props.selectedId)) return
    const next = new Set(currentExpanded.value)
    let parentId = selected.value.parentId
    while (parentId) {
      next.add(parentId)
      parentId = index.value.byId.get(parentId)?.parentId
    }
    setExpanded(next)
    await nextTick()
    const element = rowElements.get(props.selectedId),
      container = list.value
    if (!element || !container) return
    const row = element.getBoundingClientRect(),
      viewport = container.getBoundingClientRect()
    if (row.top < viewport.top) container.scrollTop -= viewport.top - row.top
    else if (row.bottom > viewport.bottom) container.scrollTop += row.bottom - viewport.bottom
  },
  { flush: 'post' },
)

function setExpanded(value) {
  if (search.value) searchExpanded.value = value
  else expanded.value = value
}
function toggleBranch(id) {
  const next = new Set(currentExpanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  setExpanded(next)
}
async function togglePanel() {
  if (open.value) return closePanel()
  open.value = true
  await nextTick()
  constrainPosition()
  searchInput.value?.focus()
}
async function closePanel() {
  stopDrag()
  open.value = false
  await nextTick()
  trigger.value?.focus()
}
function constrainPosition(left = position.value.left, top = position.value.top) {
  if (!container.value || !panel.value) return
  const maxLeft = Math.max(16, container.value.clientWidth - panel.value.offsetWidth - 16),
    maxTop = Math.max(16, container.value.clientHeight - panel.value.offsetHeight - 16)
  position.value = {
    left: Math.min(maxLeft, Math.max(16, left)),
    top: Math.min(maxTop, Math.max(16, top)),
  }
}
function startDrag(event) {
  if (drag || !event.isPrimary || event.button !== 0) return
  event.preventDefault()
  const element = container.value,
    bounds = element.getBoundingClientRect()
  drag = {
    id: event.pointerId,
    handle: event.currentTarget,
    x: event.clientX,
    y: event.clientY,
    left: position.value.left,
    top: position.value.top,
    scaleX: bounds.width / element.clientWidth || 1,
    scaleY: bounds.height / element.clientHeight || 1,
  }
  drag.handle.setPointerCapture(drag.id)
}
function movePanel(event) {
  if (!drag || drag.id !== event.pointerId) return
  constrainPosition(
    drag.left + (event.clientX - drag.x) / drag.scaleX,
    drag.top + (event.clientY - drag.y) / drag.scaleY,
  )
}
function stopDrag(event) {
  if (!drag || (event && event.pointerId !== drag.id)) return
  const { handle, id } = drag
  drag = null
  if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
}
function setRowRef(id, element) {
  if (element) rowElements.set(id, element)
  else rowElements.delete(id)
}
function select(id) {
  emit('select', id)
}
function toggleVisibility(id) {
  const state = visibility.value.get(id)
  if (state?.total) emit('visibility', { id, visible: !state.checked })
}
function toggleTranslucency(id) {
  if (visibility.value.get(id)?.total)
    emit('translucency', { id, translucent: !translucent.value.get(id) })
}
</script>

<template>
  <div
    v-if="enabled"
    ref="container"
    class="mv-tree-ui"
    @pointerdown.stop
    @pointerup.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @contextmenu.stop
  >
    <button
      v-show="!open"
      ref="trigger"
      class="mv-tree-trigger"
      type="button"
      title="构件目录"
      aria-label="构件目录"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="togglePanel"
    >
      <SvgIcon :source="componentTreeIcon" />
    </button>
    <section
      v-if="open"
      :id="panelId"
      ref="panel"
      class="mv-tree-panel"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      aria-label="构件目录"
    >
      <header
        class="mv-tree-header"
        @pointerdown.stop="startDrag"
        @pointermove.stop="movePanel"
        @pointerup.stop="stopDrag"
        @pointercancel.stop="stopDrag"
        @lostpointercapture="stopDrag"
      >
        <strong>构件目录</strong>
        <button
          class="mv-tree-close"
          type="button"
          aria-label="关闭构件目录"
          @pointerdown.stop
          @click="closePanel"
        >
          <SvgIcon :source="closeIcon" />
        </button>
      </header>
      <div class="mv-tree-search">
        <SvgIcon :source="searchIcon" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          aria-label="搜索目录构件"
          placeholder="搜索构件名称"
        />
      </div>
      <p v-if="!tree" class="mv-tree-empty" role="status">
        {{ loading ? '正在读取构件…' : '暂无模型构件' }}
      </p>
      <p v-else-if="!rows.length" class="mv-tree-empty" role="status">没有匹配的构件</p>
      <div v-else ref="list" class="mv-tree-list" role="tree" aria-label="模型构件目录">
        <div
          v-for="row in rows"
          :key="row.node.id"
          :ref="(element) => setRowRef(row.node.id, element)"
          class="mv-tree-row"
          :class="{ 'mv-tree-row-selected': selectedId === row.node.id }"
          :style="{ '--mv-tree-depth': Math.min(row.depth, 12) }"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-posinset="row.position"
          :aria-setsize="row.size"
          :aria-selected="selectedId === row.node.id"
          :aria-expanded="row.branch ? currentExpanded.has(row.node.id) : undefined"
          :aria-checked="
            visibility.get(row.node.id).total
              ? visibility.get(row.node.id).mixed
                ? 'mixed'
                : visibility.get(row.node.id).checked
              : undefined
          "
          :aria-label="row.node.name"
        >
          <button
            v-if="row.branch"
            class="mv-tree-expand"
            type="button"
            :aria-label="`${currentExpanded.has(row.node.id) ? '折叠' : '展开'} ${row.node.name}`"
            @click="toggleBranch(row.node.id)"
          >
            <SvgIcon
              :source="chevronRightIcon"
              :class="{ 'mv-tree-expanded': currentExpanded.has(row.node.id) }"
            />
          </button>
          <span v-else class="mv-tree-spacer" />
          <label class="mv-tree-check">
            <input
              type="checkbox"
              :aria-label="`显示 ${row.node.name}`"
              :checked="visibility.get(row.node.id).checked"
              :indeterminate="visibility.get(row.node.id).mixed"
              :disabled="!visibility.get(row.node.id).total"
              @change="toggleVisibility(row.node.id)"
            />
          </label>
          <button
            class="mv-tree-translucency"
            type="button"
            :aria-label="`${translucent.get(row.node.id) ? '设为不透明' : '设为半透明'} ${row.node.name}`"
            :title="
              visibility.get(row.node.id).total
                ? translucent.get(row.node.id)
                  ? '设为不透明'
                  : '设为半透明'
                : '没有可显示几何体'
            "
            :aria-pressed="translucent.get(row.node.id)"
            :disabled="!visibility.get(row.node.id).total"
            @click="toggleTranslucency(row.node.id)"
          >
            <SvgIcon :source="translucent.get(row.node.id) ? componentIcon : componentSolidIcon" />
          </button>
          <button
            class="mv-tree-name"
            type="button"
            :title="row.node.name"
            @click="select(row.node.id)"
          >
            <span class="mv-tree-label">{{ row.node.name }}</span>
          </button>
        </div>
      </div>
      <p v-if="message" class="mv-tree-message" role="status">{{ message }}</p>
    </section>
  </div>
</template>

<style scoped>
.mv-tree-ui {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  color: #edf4f6;
  font-size: 14px;
}
.mv-tree-ui button,
.mv-tree-ui input {
  box-sizing: border-box;
  margin: 0;
  font: inherit;
}
.mv-tree-ui button {
  min-height: 0;
  border-radius: 0;
  color: inherit;
  border: 0;
  cursor: pointer;
}
.mv-tree-ui button:focus-visible,
.mv-tree-search:focus-within {
  outline: 2px solid #66d9c0;
  outline-offset: -2px;
}
.mv-tree-ui .mv-svg-icon {
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
.mv-tree-trigger {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 45px;
  height: 45px;
  display: grid;
  place-items: center;
  padding: 10px;
  background: #282828;
  border-radius: 2px;
  pointer-events: auto;
}
.mv-tree-trigger .mv-svg-icon {
  width: 25px;
  height: 25px;
  color: #bfc4c6;
}
.mv-tree-trigger:hover,
.mv-tree-trigger[aria-expanded='true'] {
  background: #383e40;
}
.mv-tree-trigger:active {
  background: #475254;
}
.mv-tree-panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: min(320px, calc(100% - 32px));
  height: min(560px, calc(100% - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid #505658;
  background: #282828f5;
  box-shadow: 0 8px 24px #0005;
  pointer-events: auto;
}
.mv-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 16px;
  flex-shrink: 0;
  min-height: 44px;
  background: #171a1c;
  border-bottom: 1px solid #505658;
  cursor: move;
  user-select: none;
  touch-action: none;
}
.mv-tree-header strong {
  font-weight: 500;
  font-size: 16px;
}
.mv-tree-header .mv-tree-close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 10px;
  background: transparent;
  cursor: pointer;
}
.mv-tree-close .mv-svg-icon {
  width: 24px;
  height: 24px;
}
.mv-tree-close:hover {
  background: #383e40;
}
.mv-tree-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  flex-shrink: 0;
  margin: 0 12px;
  border-bottom: 1px solid #626a6c;
}
.mv-tree-search .mv-svg-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: #bfc4c6;
}
.mv-tree-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  padding: 10px 0;
  outline: 0;
  background: transparent;
  color: inherit;
  color-scheme: dark;
}
.mv-tree-search input::placeholder {
  color: #a4aeb2;
}
.mv-tree-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 0;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #727b7e transparent;
}
.mv-tree-row {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px 0 calc(8px + var(--mv-tree-depth) * 14px);
  outline: none;
  box-sizing: border-box;
}
.mv-tree-row:hover {
  background: #383e40;
}
.mv-tree-row-selected {
  background: #314b46;
  box-shadow: inset 2px 0 #66d9c0;
}
.mv-tree-row-selected:hover {
  background: #3a5953;
}
.mv-tree-expand,
.mv-tree-spacer {
  width: 24px;
  height: 32px;
  flex-shrink: 0;
}
.mv-tree-expand {
  display: grid;
  place-items: center;
  padding: 4px;
  background: transparent;
}
.mv-tree-expand:hover {
  color: #66d9c0;
}
.mv-tree-expand .mv-svg-icon {
  width: 16px;
  height: 16px;
}
.mv-tree-expanded {
  transform: rotate(90deg);
}
.mv-tree-row input {
  appearance: auto;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  accent-color: #28c99a;
  cursor: pointer;
  color-scheme: dark;
}
.mv-tree-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 40px;
}
.mv-tree-row input:disabled {
  cursor: default;
  opacity: 0.4;
}
.mv-tree-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  align-self: stretch;
  padding: 0 0 0 4px;
  background: transparent;
  text-align: left;
}
.mv-tree-translucency {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 40px;
  padding: 4px;
  background: transparent;
}
.mv-tree-translucency:hover:not(:disabled) {
  background: #475254;
}
.mv-tree-translucency:active:not(:disabled) {
  background: #314b46;
}
.mv-tree-translucency:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.mv-tree-translucency .mv-svg-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #bfc4c6;
}
.mv-tree-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mv-tree-empty,
.mv-tree-message {
  margin: 0;
  padding: 16px;
  line-height: 1.6;
  color: #bfc4c6;
}
.mv-tree-message {
  border-top: 1px solid #505658;
  padding: 8px 12px;
  font-size: 12px;
}
@media (pointer: coarse) {
  .mv-tree-row {
    min-height: 44px;
  }
  .mv-tree-expand,
  .mv-tree-spacer,
  .mv-tree-translucency,
  .mv-tree-check {
    height: 44px;
  }
}
@media (max-width: 600px) {
  .mv-tree-ui {
    font-size: 16px;
  }
  .mv-tree-row,
  .mv-tree-translucency,
  .mv-tree-check {
    min-height: 44px;
  }
}
</style>
