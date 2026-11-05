<script setup>
// 仅接收本地 SVG 的 ?raw 导入，不接收宿主或服务端提供的 HTML。
defineProps({ source: { type: String, required: true } })
</script>

<template>
  <span class="mv-svg-icon" aria-hidden="true" v-html="source" />
</template>

<style scoped>
.mv-svg-icon {
  display: inline-flex;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
}
.mv-svg-icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
