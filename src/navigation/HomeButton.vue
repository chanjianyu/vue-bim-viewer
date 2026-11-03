<script setup>
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
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 11 12 2l10 9h-4v10h-4v-7h-4v7H6V11Z" />
    </svg>
  </button>
</template>
