<template>
  <div class="page report-page">
    <van-nav-bar title="我看完了" left-arrow @click-left="$router.back()" />

    <div class="context-banner" v-if="triageCtx">
      <span class="context-icon">&#x1F4CB;</span>
      <div class="context-info">
        <p>你之前因为「{{ triageCtx.complaint }}」向小科做过分析，这次结果可以继续接着看。</p>
      </div>
    </div>

    <div class="content">
      <div class="hint-card" v-if="!result && !loading">
        <p>你可以上传这次在医院做的检验单、报告单，也可以补充医生开的药和医生交代的内容。小科会帮你看懂结果重点，告诉你现在该怎么处理，后面要不要复查或复诊。</p>
      </div>

      <div class="upload-area" v-if="!loading && !result">
        <label class="upload-box">
          <van-icon name="photograph" size="36" color="var(--color-primary)" />
          <p class="upload-text">拍摄/上传检验报告</p>
          <p class="upload-hint">拍照时注意光线充足，尽量拍完整</p>
          <input type="file" accept="image/*" capture="environment" @change="onFileChange" hidden />
        </label>
      </div>

      <div class="loading-area" v-if="loading">
        <van-loading size="24px" vertical>正在解读报告...</van-loading>
        <p class="loading-hint">AI 正在逐项分析，通常需要 15-30 秒</p>
      </div>

      <template v-if="result && result.analysis">
        <section class="summary-banner" :class="overviewClass">
          <div class="summary-title">结果解读</div>
          <div class="summary-main">{{ result.analysis.reportType || '检验报告' }}</div>
          <p class="summary-sub">{{ summaryLine }}</p>
        </section>

        <section class="card">
          <div class="card-title">现在怎么办</div>
          <ul class="bullet-list">
            <li v-for="(item, index) in actionItems" :key="index">{{ item }}</li>
          </ul>
        </section>

        <section class="card" v-if="followupItems.length">
          <div class="card-title">复查复诊建议</div>
          <ul class="bullet-list">
            <li v-for="(item, index) in followupItems" :key="index">{{ item }}</li>
          </ul>
        </section>

        <section class="card" v-if="noticeItems.length">
          <div class="card-title">注意事项</div>
          <div class="notice-list">
            <div class="notice-row" v-for="(item, index) in noticeItems" :key="index">
              <div class="notice-name">{{ item.name }}</div>
              <div class="notice-desc">{{ item.desc }}</div>
            </div>
          </div>
        </section>

        <div class="disclaimer">
          <p>{{ result.disclaimer || '以上解读仅供参考，具体诊断请咨询医生。' }}</p>
        </div>

        <div class="actions">
          <van-button block round type="primary" @click="saveScreenshot">
            截图保存
          </van-button>
          <van-button block round plain type="primary" @click="reset" style="margin-top: 12px;">
            解读另一份报告
          </van-button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { showToast } from 'vant'
import { analyzeReport } from '../api'

const loading = ref(false)
const result = ref(null)

const triageCtx = ref(null)
try {
  const raw = localStorage.getItem('triageContext')
  if (raw) {
    const ctx = JSON.parse(raw)
    if (Date.now() - ctx.timestamp < 30 * 24 * 60 * 60 * 1000 && ctx.complaint) {
      triageCtx.value = ctx
    }
  }
} catch { /* ignore */ }

const abnormalItems = computed(() => {
  return (result.value?.analysis?.items || []).filter((item) => item.status !== '正常').slice(0, 4)
})

const overviewClass = computed(() => {
  const count = result.value?.analysis?.abnormalCount || 0
  if (count === 0) return 'good'
  if (count <= 2) return 'warn'
  return 'alert'
})

const summaryLine = computed(() => {
  const summary = result.value?.analysis?.summary || ''
  if (summary) return summary
  const count = result.value?.analysis?.abnormalCount || 0
  if (count === 0) return '整体看没有明显异常，先按目前情况继续观察。'
  return `当前有 ${count} 项结果需要重点关注，先看最关键的异常项和接下来怎么处理。`
})

const actionItems = computed(() => {
  const suggestions = result.value?.analysis?.suggestions || []
  if (suggestions.length) return suggestions.slice(0, 4)
  if (!abnormalItems.value.length) return ['目前没有明显需要立刻处理的异常，先按医生原来的要求继续观察。']
  return ['先把报告里异常的几项给医生看，再确认是否需要进一步检查或调整用药。']
})

const followupItems = computed(() => {
  const items = []
  const days = result.value?.analysis?.followUpDays || 0
  if (days > 0) {
    items.push(`建议约 ${days} 天后复查，复查时把这次报告和用药情况一起带上。`)
  }
  if (abnormalItems.value.length) {
    items.push(`复查或复诊时重点关注：${abnormalItems.value.map((item) => item.name).slice(0, 3).join('、')}。`)
  }
  return items.slice(0, 3)
})

const noticeItems = computed(() => {
  const items = abnormalItems.value.map((item) => ({
    name: item.name || '异常项',
    desc: item.explanation || `${item.value || ''}${item.unit || ''}，建议结合医生意见继续判断。`,
  }))
  if (!items.length && result.value?.analysis?.items?.length) {
    return result.value.analysis.items.slice(0, 2).map((item) => ({
      name: item.name || '指标',
      desc: item.reference ? `当前结果 ${item.value || ''}${item.unit || ''}，参考范围 ${item.reference}。` : '目前没有明显异常解释。',
    }))
  }
  return items.slice(0, 4)
})

function reset() {
  result.value = null
}

function saveScreenshot() {
  showToast('请使用手机截屏功能保存此页面')
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''

  loading.value = true
  result.value = null

  try {
    const context = triageCtx.value
      ? `患者因「${triageCtx.value.complaint}」就诊，既往分析摘要：${triageCtx.value.summaryForDoctor || '无'}`
      : undefined
    const res = await analyzeReport(file, context)
    if (res.ok) {
      result.value = res
    } else {
      showToast(res.error || '解读失败，请确保图片清晰')
    }
  } catch {
    showToast('网络错误，请重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.report-page {
  background: var(--color-bg);
  min-height: 100vh;
}

.context-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px var(--spacing-md);
  background: #e6f7ff;
  border-bottom: 1px solid #91d5ff;
}
.context-icon { font-size: 20px; }
.context-info p {
  font-size: var(--font-size-sm);
  color: #096dd9;
  line-height: 1.4;
}

.content { padding: var(--spacing-md) 0; }

.hint-card {
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
}
.hint-card p {
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  line-height: 1.7;
}

.upload-area { margin: var(--spacing-md); }
.upload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 140px;
  background: var(--color-white);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
}
.upload-text {
  font-size: var(--font-size-md);
  font-weight: 500;
  margin-top: var(--spacing-sm);
}
.upload-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
  margin-top: 4px;
}

.loading-area {
  text-align: center;
  padding: 60px var(--spacing-md);
}
.loading-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
  margin-top: var(--spacing-md);
}

.summary-banner {
  margin: var(--spacing-md);
  padding: 18px 16px;
  border-radius: var(--radius-lg);
  color: white;
}
.summary-banner.good { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-deep)); }
.summary-banner.warn { background: linear-gradient(135deg, #ffcc59, #faad14); }
.summary-banner.alert { background: linear-gradient(135deg, #ff7d6d, #ff4d4f); }
.summary-title {
  font-size: var(--font-size-sm);
  opacity: 0.92;
}
.summary-main {
  margin-top: 6px;
  font-size: 24px;
  line-height: 1.35;
  font-weight: 700;
}
.summary-sub {
  margin-top: 8px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  opacity: 0.96;
}

.card {
  background: var(--color-white);
  border-radius: var(--radius-md);
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.card-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  margin-bottom: 12px;
}

.bullet-list {
  list-style: none;
}
.bullet-list li {
  position: relative;
  padding-left: 14px;
  line-height: 1.7;
  color: var(--color-text);
}
.bullet-list li + li { margin-top: 6px; }
.bullet-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-primary);
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.notice-row {
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 10px;
}
.notice-name {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text);
}
.notice-desc {
  margin-top: 4px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.disclaimer {
  text-align: center;
  padding: var(--spacing-md);
}
.disclaimer p {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
}

.actions {
  padding: var(--spacing-md);
  padding-bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom));
}
</style>
