<template>
  <div class="page hospital-page">
    <van-nav-bar title="我在医院" left-arrow @click-left="$router.back()" />

    <div class="tab-bar">
      <div class="tab-item" :class="{ active: mode === 'check' }" @click="switchMode('check')">
        <span class="tab-icon">&#x1F4CB;</span>
        <span>检查单</span>
      </div>
      <div class="tab-item" :class="{ active: mode === 'prescription' }" @click="switchMode('prescription')">
        <span class="tab-icon">&#x1F48A;</span>
        <span>处方单</span>
      </div>
    </div>

    <div class="context-banner" v-if="triageCtx">
      <span class="context-icon">&#x1F4CB;</span>
      <div class="context-info">
        <p>你之前因为「{{ triageCtx.complaint }}」向小科做过分析，这次可以直接接着问。</p>
      </div>
    </div>

    <div class="content">
      <div class="hint-card" v-if="!result && !loading">
        <p v-if="mode === 'check'">
          你可以先说这次最想和医生确认什么，也可以直接拍下检查单。小科会先帮你想好怎么说、怎么问，再帮你判断哪些检查更值得先做。
        </p>
        <p v-else>
          你也可以直接拍下处方。小科会帮你区分核心用药和辅助用药，看看哪些地方值得再和医生确认。
        </p>
      </div>

      <div class="upload-area" v-if="!loading && !result">
        <label class="upload-box">
          <van-icon name="photograph" size="36" color="var(--color-primary)" />
          <p class="upload-text">{{ mode === 'check' ? '拍摄/上传检查单' : '拍摄/上传处方' }}</p>
          <p class="upload-hint">支持拍照或从相册选取</p>
          <input type="file" accept="image/*" capture="environment" @change="onFileChange" hidden />
        </label>
      </div>

      <div class="loading-area" v-if="loading">
        <van-loading size="24px" vertical>
          {{ mode === 'check' ? '正在分析检查单...' : '正在分析处方...' }}
        </van-loading>
        <p class="loading-hint">AI 正在识别和分析，通常需要 10-20 秒</p>
      </div>

      <template v-if="result">
        <section class="card">
          <div class="card-title">小科建议</div>
          <p class="lead-text">{{ leadAdvice }}</p>
        </section>

        <section class="card">
          <div class="card-title">怎么说症状</div>
          <div class="script-box">“{{ symptomScript }}”</div>
        </section>

        <section class="card" v-if="questionItems.length">
          <div class="card-title">怎么问检查和用药</div>
          <ul class="bullet-list">
            <li v-for="(item, index) in questionItems" :key="index">{{ item }}</li>
          </ul>
        </section>

        <section class="card" v-if="mode === 'check' && checkRows.length">
          <div class="card-title">解读检查单和处方</div>
          <div class="list-rows">
            <div class="list-row" v-for="(item, index) in checkRows" :key="index">
              <div class="row-main">
                <div class="row-title">{{ item.name }}</div>
                <div class="row-desc">{{ item.reason }}</div>
              </div>
              <div class="row-side">
                <div class="row-price">{{ item.price }}</div>
                <div class="row-source" v-if="item.source">{{ item.source }}</div>
                <div class="row-badge" :class="item.badgeClass">{{ item.badge }}</div>
              </div>
            </div>
          </div>
          <p class="foot-note" v-if="savingText">{{ savingText }}</p>
        </section>

        <section class="card" v-if="mode === 'prescription' && medicineRows.length">
          <div class="card-title">解读检查单和处方</div>
          <div class="list-rows">
            <div class="list-row" v-for="(item, index) in medicineRows" :key="index">
              <div class="row-main">
                <div class="row-title">{{ item.name }}</div>
                <div class="row-desc">{{ item.reason }}</div>
              </div>
              <div class="row-side">
                <div class="row-price">{{ item.price }}</div>
                <div class="row-badge" :class="item.badgeClass">{{ item.badge }}</div>
              </div>
            </div>
          </div>
          <p class="foot-note" v-if="interactionNote">{{ interactionNote }}</p>
        </section>

        <div class="disclaimer">
          <p>{{ result.disclaimer || '以上分析仅供参考，具体请遵医嘱。' }}</p>
        </div>

        <div class="actions">
          <van-button block round plain type="primary" @click="reset">
            重新上传分析
          </van-button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { showToast } from 'vant'
import { analyzeCheckSheet, analyzePrescription } from '../api'

const mode = ref('check')
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

const checkRows = computed(() => {
  const items = result.value?.analysis?.items || []
  return items.slice(0, 6).map((item) => ({
    name: item.name || '检查项目',
    reason: item.reason || '建议结合医生面诊结果再确认。',
    price: item.priceRange || '价格待确认',
    badge: normalizeCheckPriority(item.priority),
    badgeClass: normalizeCheckPriorityClass(item.priority),
  }))
})

const medicineRows = computed(() => {
  const medicines = result.value?.analysis?.medicines || []
  return medicines.slice(0, 6).map((item) => ({
    name: item.brandName ? `${item.name} / ${item.brandName}` : (item.name || '药品'),
    reason: item.reason || '建议结合医生说明再确认。',
    price: item.priceRange || item.insuranceType || '价格待确认',
    source: item.source || '',
    badge: normalizeMedicineNecessity(item.necessity),
    badgeClass: normalizeMedicineClass(item.necessity),
  }))
})

const leadAdvice = computed(() => {
  const note = result.value?.analysis?.note
  if (note) return note
  return mode.value === 'check'
    ? '先把检查顺序和必要性问清楚，再决定哪些项目当天就做。'
    : '先把核心用药和辅助用药分清楚，再决定哪些地方需要和医生确认。'
})

const symptomScript = computed(() => {
  if (triageCtx.value?.summaryForDoctor) return triageCtx.value.summaryForDoctor
  if (triageCtx.value?.complaint) return `我这次主要是 ${triageCtx.value.complaint}，想先确认最需要先做什么检查或用药。`
  return '我这次最难受的是现在这个症状，想先确认哪些检查或用药是最需要先处理的。'
})

const questionItems = computed(() => {
  const script = result.value?.analysis?.script ? [result.value.analysis.script] : []
  const defaults = mode.value === 'check'
    ? [
        '这几项里，哪些是今天一定要先做的？',
        '有没有哪几项可以等前面结果出来后再决定？',
        '如果我最近做过类似检查，现在还需要重复做吗？',
      ]
    : [
        '这几种药里，哪些是核心用药，哪些更偏辅助？',
        '有没有价格更合适、作用相近的替代方案？',
        '这次先用哪些药更关键，其他的是不是可以再确认？',
      ]
  return Array.from(new Set([...script, ...defaults])).slice(0, 4)
})

const savingText = computed(() => {
  return result.value?.analysis?.savingEstimate
    ? `费用提示：${result.value.analysis.savingEstimate}`
    : ''
})

const interactionNote = computed(() => {
  return result.value?.analysis?.interactions || ''
})

function switchMode(m) {
  if (loading.value) return
  mode.value = m
  result.value = null
}

function reset() {
  result.value = null
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  e.target.value = ''

  loading.value = true
  result.value = null

  try {
    const fn = mode.value === 'check' ? analyzeCheckSheet : analyzePrescription
    const context = triageCtx.value
      ? `患者因「${triageCtx.value.complaint}」就诊，既往分析摘要：${triageCtx.value.summaryForDoctor || '无'}`
      : undefined
    const res = await fn(file, context)
    if (res.ok) {
      result.value = res
    } else {
      showToast(res.error || '分析失败，请重试')
    }
  } catch {
    showToast('网络错误，请重试')
  } finally {
    loading.value = false
  }
}

function normalizeCheckPriority(priority) {
  if (priority === '必要') return '先做'
  if (priority === '可等') return '可再确认'
  return '问医生'
}

function normalizeCheckPriorityClass(priority) {
  if (priority === '必要') return 'badge-primary'
  if (priority === '可等') return 'badge-muted'
  return 'badge-warn'
}

function normalizeMedicineNecessity(necessity) {
  if (necessity === '核心') return '核心'
  if (necessity === '辅助') return '辅助'
  return '可再确认'
}

function normalizeMedicineClass(necessity) {
  if (necessity === '核心') return 'badge-primary'
  if (necessity === '辅助') return 'badge-warn'
  return 'badge-muted'
}
</script>

<style scoped>
.hospital-page {
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

.tab-bar {
  display: flex;
  background: var(--color-white);
  border-bottom: 1px solid var(--color-border);
}
.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 0;
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
}
.tab-item.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}
.tab-icon { font-size: 18px; }

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
  color: var(--color-text);
  margin-top: var(--spacing-sm);
  font-weight: 500;
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

.lead-text {
  font-size: var(--font-size-md);
  line-height: 1.7;
  color: var(--color-text);
}

.script-box {
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: var(--font-size-md);
  color: var(--color-primary);
  line-height: 1.7;
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

.list-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.list-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 10px;
}
.row-main {
  min-width: 0;
}
.row-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text);
}
.row-desc {
  margin-top: 3px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.row-side {
  flex-shrink: 0;
  text-align: right;
}
.row-price {
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  font-weight: 600;
}
.row-source {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-secondary);
}
.row-badge {
  margin-top: 6px;
  display: inline-block;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
}
.badge-primary { background: #e8f8f0; color: var(--color-primary); }
.badge-muted { background: #f1f2f4; color: var(--color-text-hint); }
.badge-warn { background: #fff7e6; color: #d48806; }

.foot-note {
  margin-top: 10px;
  font-size: var(--font-size-sm);
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
