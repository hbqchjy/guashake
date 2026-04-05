<template>
  <DisclaimerPopup />
  <router-view v-slot="{ Component }">
    <transition name="slide" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
</template>

<script setup>
import DisclaimerPopup from './components/DisclaimerPopup.vue'
</script>

<style>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
