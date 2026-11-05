<script setup>
import SvgIcon from '../SvgIcon.vue'
import homeIcon from '../assets/svg/home.svg?raw'

defineProps({ disabled: { type: Boolean, default: false } })
defineEmits(['home'])
</script>

<template>
  <button
    type="button"
    class="mv-navigation-home"
    :disabled="disabled"
    title="主视角"
    aria-label="Home：恢复初始全模型视角"
    @click.stop="$emit('home')"
  >
    <SvgIcon :source="homeIcon" />
  </button>
</template>
