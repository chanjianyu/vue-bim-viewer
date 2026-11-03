<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { projectViewCube } from './view-cube.js'

const props = defineProps({
  orientation: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['navigate', 'restore-focus'])
const faces = computed(() => projectViewCube(props.orientation))
const cube = ref()
const focused = ref(null)
watch(
  faces,
  async (values) => {
    const id = focused.value
    if (!id || !cube.value?.contains(document.activeElement)) return
    // SVG 深度排序会移动现有节点；部分浏览器在移动时也会丢失焦点。
    await nextTick()
    if (!cube.value) return
    if (!values.some((face) => face.id === id)) {
      emit('restore-focus')
    } else {
      cube.value.querySelector(`[data-direction="${id}"]`)?.focus({ preventScroll: true })
    }
  },
  { flush: 'pre' },
)
function activate(id) {
  if (!props.disabled) emit('navigate', id)
}
</script>

<template>
  <svg
    ref="cube"
    class="mv-navigation-cube"
    viewBox="0 0 150 150"
    role="group"
    aria-label="26方向视角骰子"
  >
    <g
      v-for="face in faces"
      :key="face.id"
      class="mv-navigation-region"
      :class="`mv-navigation-${face.kind}`"
      :data-direction="face.id"
      role="button"
      :tabindex="disabled ? -1 : 0"
      :aria-disabled="disabled"
      :aria-label="`${face.label}视角`"
      @click.stop="activate(face.id)"
      @keydown.enter.prevent.stop="activate(face.id)"
      @keydown.space.prevent.stop="activate(face.id)"
      @focus="focused = face.id"
      @blur="focused = null"
    >
      <title>{{ face.label }}视角</title>
      <polygon :points="face.points" />
      <text
        v-if="face.kind === 'face'"
        :transform="face.textTransform"
        text-anchor="middle"
        dominant-baseline="central"
        aria-hidden="true"
      >
        {{ face.label }}
      </text>
    </g>
  </svg>
</template>
