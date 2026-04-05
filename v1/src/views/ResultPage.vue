<template>
  <div class="page result-page">
    <van-nav-bar title="小科分析" left-arrow @click-left="$router.push('/')" />

    <van-loading v-if="loading" class="page-loading" size="24px" vertical>{{ loadingText }}</van-loading>

    <template v-if="!loading && result">
      <div class="summary-banner" :class="severityClass">
        <div class="summary-title">小科分析</div>
        <div class="summary-main">{{ analysisTitle }}</div>
        <p class="summary-sub">{{ analysisSubtitle }}</p>
      </div>

      <section class="card" v-if="actionItems.length">
        <div class="card-title">现在怎么办</div>
        <ul class="bullet-list">
          <li v-for="(item, index) in actionItems" :key="index">{{ item }}</li>
        </ul>
      </section>

      <section class="card" v-if="medicationItems.length">
        <div class="card-title">用药建议</div>
        <div class="tag-note" v-if="medicationLead">{{ medicationLead }}</div>
        <ul class="bullet-list">
          <li v-for="(item, index) in medicationItems" :key="index">{{ item }}</li>
        </ul>
      </section>

      <section class="card" v-if="showChecksCard">
        <div class="card-title">检查项目与费用</div>
        <div class="check-list">
          <div class="check-row" v-for="(item, index) in checkItems" :key="index">
            <div class="check-main">
              <div class="check-name">{{ item.name }}</div>
              <div class="check-meta">{{ item.priority }}</div>
            </div>
            <div class="check-price">{{ item.price }}</div>
          </div>
        </div>
        <p class="check-total" v-if="checkTotal">{{ checkTotal }}</p>
      </section>

      <section class="card card-danger" v-if="riskItems.length">
        <div class="card-title">风险提醒</div>
        <ul class="bullet-list danger-list">
          <li v-for="(item, index) in riskItems" :key="index">{{ item }}</li>
        </ul>
      </section>

      <div class="actions">
        <van-button v-if="!archiveMode" block round type="primary" @click="continueAnalysis">
          补充信息继续分析
        </van-button>
        <van-button v-if="!archiveMode" block round plain type="primary" @click="saveAnalysis" style="margin-top: 12px;">
          保存分析
        </van-button>
        <van-button v-if="archiveMode" block round type="primary" @click="shareCurrentAnalysis">
          分享
        </van-button>
        <van-button v-if="archiveMode" block round plain type="danger" @click="deleteCurrentAnalysis" style="margin-top: 12px;">
          删除分析
        </van-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { getTriageResult, getCostEstimate, saveArchiveRecord, getArchiveRecord, deleteArchiveRecord } from '../api'

const props = defineProps({ sessionId: String })
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const result = ref(null)
const costEstimate = ref(null)
const archiveRecord = ref(null)
const archiveMode = computed(() => Boolean(archiveRecord.value?.id))
const loadingText = computed(() => (String(route.query.recordId || '').trim() && localStorage.getItem('userId'))
  ? '正在读取已保存分析...'
  : '正在生成分析...')

const severityMap = {
  observe: { label: '可先观察', className: 'observe' },
  self_treat: { label: '先自行处理', className: 'self-treat' },
  routine_clinic: { label: '建议门诊就诊', className: 'visit-soon' },
  specialist_clinic: { label: '建议尽快就诊', className: 'visit-today' },
  hospital_priority_high: { label: '建议尽快去医院', className: 'emergency' },
  visit_soon: { label: '建议近期就诊', className: 'visit-soon' },
  visit_today: { label: '建议尽快就诊', className: 'visit-today' },
  emergency: { label: '建议立即急诊', className: 'emergency' },
}

const recommendationLevel = computed(() => result.value?.layeredOutput?.core?.recommendationLevel || result.value?.severity || 'visit_soon')
const severityClass = computed(() => severityMap[recommendationLevel.value]?.className || 'visit-soon')
const severityLabel = computed(() => severityMap[recommendationLevel.value]?.label || '建议就诊')

const needsHospital = computed(() => {
  return ['routine_clinic', 'specialist_clinic', 'hospital_priority_high', 'visit_soon', 'visit_today', 'emergency'].includes(recommendationLevel.value)
})

const analysisTitle = computed(() => {
  const possible = result.value?.layeredOutput?.core?.possibleTypes || []
  const top = possible[0] || result.value?.layeredOutput?.core?.text || ''
  return top || severityLabel.value
})

const analysisSubtitle = computed(() => {
  return result.value?.layeredOutput?.core?.text || result.value?.severityReason || '我先根据你这次描述，把当前最关键的判断整理出来。'
})

const actionItems = computed(() => {
  const detail = result.value?.layeredOutput?.detail || {}
  const core = result.value?.layeredOutput?.core || {}
  const items = [
    ...(detail.visitAdvice || []),
    ...(detail.selfCareAdvice || []),
  ].filter(Boolean)
  const uniq = Array.from(new Set(items))
  if (uniq.length) return uniq.slice(0, 4)
  if (core.text) return [core.text]
  return []
})

const medicationLead = computed(() => {
  const refs = costEstimate.value?.expanded?.medicationPriceRefs || []
  if (!refs.length) return ''
  return '优先展示常见药与参考价。'
})

const medicationItems = computed(() => {
  const detail = result.value?.layeredOutput?.detail || {}
  const advice = (detail.medicationAdvice || []).filter(Boolean).slice(0, 4)
  const refs = (costEstimate.value?.expanded?.medicationPriceRefs || []).slice(0, 3)
  const priceLines = refs.map((item) => {
    const name = item.name || item.category || '常见药物'
    const price = item.priceRange || item.price || ''
    const source = item.source === '本地参考' ? '本地' : (item.source === '模型参考' ? '模型' : '')
    const tags = [source, item.insuranceType].filter(Boolean).join(' / ')
    return price ? `${name}${tags ? `（${tags}）` : ''}：${price}` : `${name}${tags ? `（${tags}）` : ''}`
  })
  const fallbackPriceLines = priceLines.length ? [] : buildMedicationFallbackPrices(advice)
  return Array.from(new Set([...advice, ...priceLines, ...fallbackPriceLines])).slice(0, 4)
})

const checkItems = computed(() => {
  const estimateItems = costEstimate.value?.expanded?.feeItems || []
  if (estimateItems.length) {
    return estimateItems.slice(0, 5).map(item => ({
      name: item.name || item.label || '检查项目',
      priority: item.priority || '建议先做',
      price: item.priceRange || item.price || formatRange(item.min, item.max),
    }))
  }
  const firstChecks = result.value?.layeredOutput?.core?.firstChecks || []
  return firstChecks.slice(0, 5).map(item => ({
    name: item.name || item,
    priority: item.priority || '建议先做',
    price: item.price_range || item.priceRange || formatRange(item.min, item.max),
  }))
})

const checkTotal = computed(() => {
  const simple = costEstimate.value?.simple
  if (simple?.costRange) return `合计参考：${simple.costRange}`
  const fallback = result.value?.layeredOutput?.core?.firstCostRange || archiveRecord.value?.costRange || ''
  return fallback ? `合计参考：${fallback}` : ''
})

const showChecksCard = computed(() => needsHospital.value && checkItems.value.length > 0)

const riskItems = computed(() => {
  const items = result.value?.layeredOutput?.riskReminder || result.value?.red_flags || []
  return Array.from(new Set(items.filter(Boolean))).slice(0, 5)
})

const archiveTitle = computed(() => {
  const now = new Date()
  const dateLabel = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const type = String(
    result.value?.layeredOutput?.core?.possibleTypes?.[0]
    || analysisTitle.value
    || '问诊分析',
  ).replace(/\s+/g, ' ').trim()
  return `${dateLabel} ${type}`.trim()
})

function formatRange(min, max) {
  if (min && max) return `${min}~${max}元`
  if (min || max) return `${min || max}元`
  return ''
}

function buildMedicationFallbackPrices(advice = []) {
  const text = advice.join(' ')
  if (!text) return []
  if (/胃|抑酸|护胃|胃黏膜|止泻|腹泻/.test(text)) {
    return ['常见护胃药：约 20~60 元', '常见止泻药：约 15~40 元']
  }
  if (/退热|发热/.test(text)) {
    return ['常见退热药：约 15~35 元']
  }
  if (/止咳|化痰|含片|咽痛|咳嗽/.test(text)) {
    return ['常见止咳化痰药：约 20~50 元', '常见含片：约 10~30 元']
  }
  if (/人工泪液|眼/.test(text)) {
    return ['常见人工泪液：约 20~60 元']
  }
  if (/止痛|外用/.test(text)) {
    return ['常见外用止痛药：约 20~50 元']
  }
  return ['常见对症药：约 20~60 元']
}

onMounted(async () => {
  const sid = props.sessionId || route.params.sessionId
  const recordId = String(route.query.recordId || '').trim()
  const userId = localStorage.getItem('userId')
  if (!sid) {
    router.push('/')
    return
  }
  try {
    if (recordId && userId) {
      const saved = await getArchiveRecord(userId, recordId)
      const record = saved.record || saved
      archiveRecord.value = record
      result.value = {
        severity: record.severity || record.summarySnapshot?.core?.recommendationLevel || '',
        red_flags: [],
        layeredOutput: record.summarySnapshot || {
          core: {
            text: record.summaryText || record.summary || '',
            possibleTypes: record.likelyType ? [record.likelyType] : [],
            recommendationLevel: record.summarySnapshot?.core?.recommendationLevel || '',
            firstChecks: record.firstChecks || [],
            firstCostRange: record.costRange || '',
          },
          detail: {
            selfCareAdvice: [],
            medicationAdvice: [],
            visitAdvice: [],
          },
          riskReminder: [],
        },
      }
      return
    }
    const triageRes = await getTriageResult(sid)
    result.value = triageRes
    if (triageRes?.layeredOutput?.core?.needsCost || needsHospital.value || (triageRes?.layeredOutput?.detail?.medicationAdvice || []).length) {
      try {
        costEstimate.value = await getCostEstimate({ sessionId: sid })
      } catch {
        costEstimate.value = null
      }
    }
  } catch {
    showToast('获取结果失败')
  } finally {
    loading.value = false
  }
})

function continueAnalysis() {
  const sid = props.sessionId || route.params.sessionId
  if (!sid) return
  router.push({
    path: '/triage',
    query: {
      sessionId: sid,
      mode: 'supplement',
      title: analysisTitle.value || localStorage.getItem('currentComplaint') || '',
    },
  })
}

async function saveAnalysis() {
  const userId = localStorage.getItem('userId')
  const sid = props.sessionId || route.params.sessionId
  if (!userId) {
    showToast('请先登录后保存分析')
    router.push('/login')
    return
  }
  try {
    const ctx = {
      sessionId: sid,
      complaint: localStorage.getItem('currentComplaint') || '',
      summaryForDoctor: analysisSubtitle.value,
      checks: checkItems.value.map(c => c.name),
      timestamp: Date.now(),
    }
    localStorage.setItem('triageContext', JSON.stringify(ctx))
    localStorage.removeItem('draftSessionId')
    localStorage.removeItem('draftComplaint')
    await saveArchiveRecord({
      userId,
      sessionId: sid,
      summary: archiveTitle.value,
    })
    showToast('分析已保存')
  } catch {
    showToast('保存失败，请稍后重试')
  }
}

async function shareCurrentAnalysis() {
  const sid = props.sessionId || route.params.sessionId
  const recordId = String(route.query.recordId || '').trim()
  const url = recordId
    ? `${window.location.origin}/v1/result/${sid}?recordId=${recordId}`
    : `${window.location.origin}/v1/result/${sid}`
  const title = archiveRecord.value?.summary || archiveTitle.value
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url })
      return
    } catch {
      // ignore cancellation
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    showToast('已复制链接')
  } catch {
    showToast('请使用浏览器或微信的分享功能')
  }
}

async function deleteCurrentAnalysis() {
  const userId = localStorage.getItem('userId')
  const recordId = String(route.query.recordId || '').trim()
  if (!userId || !recordId) return
  try {
    await showConfirmDialog({
      title: '删除分析',
      message: '删除后无法恢复，确定删除这条分析吗？',
    })
  } catch {
    return
  }
  try {
    await deleteArchiveRecord(userId, recordId)
    showToast('已删除')
    router.push('/records')
  } catch {
    showToast('删除失败')
  }
}
</script>

<style scoped>
.result-page {
  background: var(--color-bg);
  min-height: 100vh;
}

.page-loading {
  display: flex;
  justify-content: center;
  padding-top: 30vh;
}

.summary-banner {
  margin: var(--spacing-md);
  padding: 18px 16px;
  border-radius: var(--radius-lg);
  color: white;
}
.summary-banner.observe { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-deep)); }
.summary-banner.self-treat { background: linear-gradient(135deg, #48a7ff, #1890ff); }
.summary-banner.visit-soon { background: linear-gradient(135deg, #ffcc59, #faad14); }
.summary-banner.visit-today { background: linear-gradient(135deg, #ff7d6d, #ff4d4f); }
.summary-banner.emergency { background: linear-gradient(135deg, #575757, #222); }

.summary-title {
  font-size: var(--font-size-sm);
  opacity: 0.92;
}
.summary-main {
  margin-top: 6px;
  font-size: 26px;
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
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.card-danger {
  background: #fff5f5;
  border: 1px solid #ffd9d9;
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 10px;
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
.bullet-list li + li {
  margin-top: 6px;
}
.bullet-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-primary);
}
.danger-list li::before {
  background: #ff4d4f;
}

.tag-note {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #f5fbf8;
  border-radius: 10px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 10px;
}
.check-main {
  min-width: 0;
}
.check-name {
  font-size: var(--font-size-md);
  color: var(--color-text);
  font-weight: 600;
}
.check-meta {
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
}
.check-price {
  flex-shrink: 0;
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  font-weight: 600;
}
.check-total {
  margin-top: 10px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.actions {
  padding: 0 var(--spacing-md) calc(var(--spacing-lg) + env(safe-area-inset-bottom));
}
</style>
