<template>
  <van-overlay :show="!accepted" z-index="9999" lock-scroll>
    <div class="disclaimer-wrapper">
      <div class="disclaimer-box">
        <h2 class="disclaimer-title">使用须知</h2>

        <div class="disclaimer-body">
          <p class="disclaimer-highlight">
            「小科」是一款就医信息辅助工具，帮助你在就医过程中做出更有依据的判断。
          </p>

          <div class="disclaimer-section">
            <h4>重要声明</h4>
            <ul>
              <li>本工具<strong>不是医疗机构</strong>，不提供诊断、处方或治疗方案</li>
              <li>所有分析结果<strong>仅供参考</strong>，不能替代医生面诊</li>
              <li>紧急情况请立即拨打 <strong>120</strong> 或前往最近急诊</li>
            </ul>
          </div>

          <div class="disclaimer-section">
            <h4>信息安全</h4>
            <ul>
              <li>你上传的图片仅用于分析，不会用于其他目的</li>
              <li>你的健康信息会被加密保存在本地服务器</li>
            </ul>
          </div>
        </div>

        <div class="disclaimer-check">
          <van-checkbox v-model="checked" shape="square" icon-size="18">
            我已阅读并理解以上内容
          </van-checkbox>
        </div>

        <van-button
          block
          round
          type="primary"
          :disabled="!checked"
          @click="onAccept"
        >
          我知道了，开始使用
        </van-button>
      </div>
    </div>
  </van-overlay>
</template>

<script setup>
import { ref } from 'vue'
import { useDisclaimer } from '../composables/useDisclaimer'

const { accepted, accept } = useDisclaimer()
const checked = ref(false)

function onAccept() {
  if (checked.value) {
    accept()
  }
}
</script>

<style scoped>
.disclaimer-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.disclaimer-box {
  background: var(--color-white);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 340px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
}

.disclaimer-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  text-align: center;
  color: var(--color-text);
  margin-bottom: 16px;
}

.disclaimer-body {
  margin-bottom: 16px;
}

.disclaimer-highlight {
  font-size: var(--font-size-md);
  color: var(--color-primary);
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 10px;
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
}

.disclaimer-section {
  margin-bottom: 12px;
}

.disclaimer-section h4 {
  font-size: var(--font-size-md);
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--color-text);
}

.disclaimer-section ul {
  padding-left: 16px;
}

.disclaimer-section li {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.8;
}

.disclaimer-check {
  margin: 16px 0;
}
</style>
