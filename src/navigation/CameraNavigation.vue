<script setup>
import { computed, ref } from 'vue'
import HomeButton from './HomeButton.vue'
import ViewCube from './ViewCube.vue'
import { resolveNavigation } from './view-cube.js'

const props = defineProps({
  options: { type: Object },
  orientation: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
defineEmits(['home', 'navigate'])
const navigation = computed(() => resolveNavigation(props.options))
const container = ref()
</script>

<template>
  <nav
    v-if="navigation.height"
    ref="container"
    class="mv-navigation"
    :class="{ 'mv-navigation-home-only': !navigation.cube }"
    tabindex="-1"
    aria-label="视角导航"
    @pointerdown.stop
    @pointerup.stop
    @dblclick.stop
    @wheel.stop.prevent
  >
    <ViewCube
      v-if="navigation.cube"
      :orientation="orientation"
      :disabled="disabled"
      @navigate="$emit('navigate', $event)"
      @restore-focus="container?.focus({ preventScroll: true })"
    />
    <HomeButton v-if="navigation.home" :disabled="disabled" @home="$emit('home')" />
  </nav>
</template>
