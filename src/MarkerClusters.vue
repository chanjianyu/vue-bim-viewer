<script setup>
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onUpdated, ref, watch } from 'vue'

const props = defineProps({
  clusters: { type: Array, required: true },
  list: { type: Object, default: null },
  listStyle: { type: Object },
  disabled: { type: Boolean, default: false },
  enabled: { type: Boolean, default: false },
  markerRevision: { type: Number, default: 0 },
})
const emit = defineEmits(['activate', 'select', 'close', 'restore-focus'])
const container = ref(),
  closeButton = ref(),
  page = ref(0)
const pageCount = computed(() => Math.ceil((props.list?.members.length || 0) / 50))
const members = computed(
  () => props.list?.members.slice(page.value * 50, (page.value + 1) * 50) || [],
)
// 仅缓存公开成员视图，不向宿主暴露内部投影成员；相机移动时复用数组和业务引用。
const displayCache = new Map()
function displayInfo(cluster) {
  let cached = displayCache.get(cluster.id)
  if (
    !cached ||
    cached.memberIds.length !== cluster.memberIds.length ||
    cached.memberIds.some((id, index) => id !== cluster.memberIds[index]) ||
    cached.members.some(
      (member, index) =>
        member.label !== cluster.members[index].label ||
        member.data !== cluster.members[index].data,
    )
  ) {
    cached = {
      memberIds: [...cluster.memberIds],
      members: cluster.members.map(({ id, label, data }) => ({ id, label, data })),
    }
    displayCache.set(cluster.id, cached)
  }
  return {
    id: cluster.id,
    count: cluster.count,
    memberIds: cached.memberIds,
    members: cached.members,
    x: cluster.x,
    y: cluster.y,
  }
}
// Marker 业务数据改变或模型成功替换时刷新视图；关闭/卸载不保留旧成员引用。
watch([() => props.markerRevision, () => props.enabled], () => displayCache.clear(), {
  flush: 'sync',
})
watch(
  () => props.clusters,
  (clusters) => {
    const ids = new Set(clusters.map((cluster) => cluster.id))
    for (const id of displayCache.keys()) if (!ids.has(id)) displayCache.delete(id)
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => displayCache.clear())
watch(
  () => props.list?.id,
  async (id) => {
    page.value = 0
    if (id) {
      await nextTick()
      closeButton.value?.focus({ preventScroll: true })
    }
  },
)
let focusedElement
onBeforeUpdate(() => {
  const active = container.value?.ownerDocument.activeElement
  focusedElement = container.value?.contains(active) ? active : null
})
onUpdated(() => {
  // 聚合拆分或成员列表消失后不把键盘焦点遗留在已卸载的按钮上。
  if (focusedElement && !focusedElement.isConnected) {
    const active = container.value?.ownerDocument.activeElement
    if (!container.value?.contains(active)) emit('restore-focus')
  }
  focusedElement = null
})
</script>

<template>
  <div
    ref="container"
    class="mv-cluster-ui"
    @pointerdown.stop
    @pointerup.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @contextmenu.stop
  >
    <button
      v-for="cluster in clusters"
      :key="cluster.id"
      type="button"
      class="mv-marker-cluster"
      :class="{ 'mv-marker-cluster-custom': !!$slots.cluster }"
      :style="{ left: `${cluster.x}px`, top: `${cluster.y}px` }"
      :disabled="disabled"
      :aria-label="`包含 ${cluster.count} 个标记，点击展开`"
      :aria-expanded="list?.id === cluster.id"
      @click="emit('activate', cluster)"
    >
      <slot
        name="cluster"
        :cluster="displayInfo(cluster)"
        :disabled="disabled"
        :expanded="list?.id === cluster.id"
      >
        {{ cluster.count }}
      </slot>
    </button>
    <article
      v-if="list"
      class="mv-popup mv-cluster-list"
      :style="listStyle"
      role="dialog"
      aria-label="聚合标记成员"
      @keydown.esc.stop="emit('close')"
    >
      <header>
        <strong>共 {{ list.count }} 个标记</strong
        ><button
          ref="closeButton"
          type="button"
          aria-label="关闭聚合成员列表"
          @click="emit('close')"
        >
          关闭
        </button>
      </header>
      <ul>
        <li v-for="marker in members" :key="marker.id">
          <button type="button" class="mv-cluster-member" @click="emit('select', marker)">
            {{ marker.label }}
          </button>
        </li>
      </ul>
      <footer v-if="pageCount > 1">
        <button type="button" :disabled="page === 0" @click="page--">上一页</button
        ><span aria-live="polite">{{ page + 1 }} / {{ pageCount }}</span
        ><button type="button" :disabled="page + 1 === pageCount" @click="page++">下一页</button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
/* 沿用查看器标记的青绿色与浅色弹窗；不影响宿主全局按钮和字体。 */
.mv-cluster-ui {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.mv-marker-cluster {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  min-width: 44px;
  height: 44px;
  padding: 0 8px;
  border: 2px solid #edf4f6;
  border-radius: 50%;
  background: #216b59;
  color: #edf4f6;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  pointer-events: auto;
}
.mv-marker-cluster:not(.mv-marker-cluster-custom):enabled:hover {
  filter: brightness(0.8);
}
/* 自定义插槽只由 SDK 管理定位和命中区域，图形尺寸、配色及悬停由宿主绘制。 */
.mv-marker-cluster-custom {
  min-width: 44px;
  min-height: 44px;
  height: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
}
.mv-marker-cluster:focus-visible {
  outline: 2px solid #66d9c0;
  outline-offset: 2px;
}
.mv-cluster-list button:focus-visible {
  outline: 2px solid #176d93;
  outline-offset: 2px;
}
.mv-marker-cluster:disabled,
.mv-cluster-list button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.mv-cluster-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mv-cluster-list header {
  flex-shrink: 0;
}
.mv-cluster-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  min-height: 0;
}
.mv-cluster-list .mv-cluster-member {
  display: block;
  width: 100%;
  min-height: 44px;
  text-align: left;
  border: 0;
  border-radius: 0;
  overflow-wrap: anywhere;
}
.mv-cluster-member:hover {
  background: #e3e9ec;
}
.mv-cluster-list footer {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
}
.mv-cluster-list footer button {
  min-height: 44px;
}
@media (max-width: 480px) {
  .mv-marker-cluster,
  .mv-cluster-list {
    font-size: 16px;
  }
}
</style>
