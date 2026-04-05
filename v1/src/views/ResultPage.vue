<template>
  <div class="page result-page">
    <van-nav-bar title="分诊结果" left-arrow @click-left="$router.push('/')" />

    <van-loading v-if="loading" class="page-loading" size="24px" vertical>正在生成结果...</van-loading>

    <template v-if="!loading && result">
      <!-- 严重程度头部 -->
      <div class="severity-banner" :style="{ background: severityColor }">
        <div class="severity-icon">{{ severityIcon }}</div>
        <div class="severity-text">
          <h2>{{ severityLabel }}</h2>
          <p>{{ result.layeredOutput?.core?.text || result.severityReason || '根据你描述的症状' }}</p>
        </div>
      </div>

      <!-- 推荐科室 -->
      <div class="card">
        <div class="card-title">
          <span class="card-icon">&#x1F4CD;</span> 推荐科室
        </div>
        <div class="dept-name">{{ result.department || '暂无推荐' }}</div>
        <div class="dept-level" v-if="result.hospitalLevel">{{ result.hospitalLevel }}</div>
      </div>

      <!-- 进诊室准备清单 -->
      <div class="card">
        <div class="card-title">
          <span class="card-icon">&#x1F4CB;</span> 进诊室准备清单
        </div>

        <!-- 症状摘要 -->
        <div class="checklist-section" v-if="summaryText">
          <div class="section-label">症状摘要（给医生看）</div>
          <div class="summary-box">{{ summaryText }}</div>
        </div>

        <!-- 预期检查 -->
        <div class="checklist-section" v-if="checks.length">
          <div class="section-label">预期基础检查</div>
          <div class="check-item" v-for="(c, i) in checks" :key="i">
            <span class="check-name">{{ c.name }}</span>
            <span class="check-price">{{ c.priceRange || formatPrice(c.min, c.max) }}</span>
            <span class="check-priority" :class="c.priority === '必要' ? 'required' : 'optional'">
              {{ c.priority === '必要' ? '&#x2705; 先做' : '&#x23F8; 可等' }}
            </span>
          </div>
        </div>

        <!-- 话术 -->
        <div class="checklist-section" v-if="script">
          <div class="section-label">可以对医生说</div>
          <div class="script-box">"{{ script }}"</div>
        </div>
      </div>

      <!-- 疑似方向 -->
      <div class="card" v-if="suspectedDirections.length">
        <div class="card-title">
          <span class="card-icon">&#x1F50D;</span> 可能的方向
        </div>
        <div class="direction-item" v-for="(d, i) in suspectedDirections" :key="i">
          <span class="direction-name">{{ d.name || d }}</span>
          <span class="direction-note" v-if="d.note">{{ d.note }}</span>
        </div>
      </div>

      <!-- 自我护理 -->
      <div class="card" v-if="selfCare.length">
        <div class="card-title">
          <span class="card-icon">&#x1F48A;</span> 如果暂时不去医院
        </div>
        <ul class="care-list">
          <li v-for="(item, i) in selfCare" :key="i">{{ item }}</li>
        </ul>
      </div>

      <!-- 危险信号 -->
      <div class="card card-danger" v-if="redFlags.length">
        <div class="card-title">
          <span class="card-icon">&#x26A0;&#xFE0F;</span> 出现以下情况请立即就诊
        </div>
        <ul class="red-flags-list">
          <li v-for="(flag, i) in redFlags" :key="i">{{ flag }}</li>
        </ul>
      </div>

      <!-- 底部操作 -->
      <div class="actions">
        <van-button block round type="primary" @click="saveScreenshot">
          &#x1F4F1; 截图保存
        </van-button>
        <van-button block round plain type="primary" @click="goHospital" style="margin-top: 12px;">
          &#x1F3E5; 我去医院了
        </van-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showToast } from 'vant'
import { getTriageResult } from '../api'

const props = defineProps({ sessionId: String })
const router = useRouter()
const route = useRoute()

const loading = ref(true)
const result = ref(null)

const severityMap = {
  observe:     { color: '#00B578', icon: '\u{1F7E2}', label: '可观察等待' },
  self_treat:  { color: '#1890FF', icon: '\u{1F535}', label: '建议自行处理' },
  visit_soon:  { color: '#FAAD14', icon: '\u{1F7E1}', label: '建议近期就诊' },
  visit_today: { color: '#FF4D4F', icon: '\u{1F534}', label: '建议尽快就诊' },
  emergency:   { color: '#333333', icon: '\u{26AB}', label: '建议立即急诊' },
}

const severity = computed(() => result.value?.severity || 'visit_soon')
const severityColor = computed(() => severityMap[severity.value]?.color || '#FAAD14')
const severityIcon = computed(() => severityMap[severity.value]?.icon || '')
const severityLabel = computed(() => severityMap[severity.value]?.label || '建议就诊')

const summaryText = computed(() => {
  const lo = result.value?.layeredOutput
  return lo?.detail?.summaryForDoctor || result.value?.checklist?.summary || ''
})

const checks = computed(() => {
  const raw = result.value?.firstChecks || result.value?.checklist?.expected_checks || []
  return raw.map(c => ({
    name: c.name,
    min: c.min,
    max: c.max,
    priceRange: c.price_range || c.priceRange || '',
    priority: c.priority || '必要',
  }))
})

const script = computed(() => {
  return result.value?.layeredOutput?.detail?.scriptForDoctor
    || result.value?.checklist?.script
    || ''
})

const suspectedDirections = computed(() => {
  return result.value?.layeredOutput?.detail?.suspectedDirections || []
})

const selfCare = computed(() => {
  const lo = result.value?.layeredOutput
  return lo?.detail?.selfCareAdvice || result.value?.self_care || []
})

const redFlags = computed(() => {
  return result.value?.layeredOutput?.riskReminder || result.value?.red_flags || []
})

function formatPrice(min, max) {
  if (!min && !max) return ''
  if (min && max) return `${min}-${max}元`
  return `${min || max}元`
}

onMounted(async () => {
  const sid = props.sessionId || route.params.sessionId
  if (!sid) {
    router.push('/')
    return
  }
  try {
    const res = await getTriageResult(sid)
    result.value = res
  } catch (e) {
    showToast('获取结果失败')
  } finally {
    loading.value = false
  }
})

function saveScreenshot() {
  showToast('请使用手机截屏功能保存此页面')
}

function goHospital() {
  // 保存分诊上下文，供"我在医院"和"我看完了"使用
  if (result.value) {
    const ctx = {
      sessionId: props.sessionId || route.params.sessionId,
      department: result.value.department || '',
      complaint: localStorage.getItem('currentComplaint') || '',
      severity: severity.value,
      summaryForDoctor: summaryText.value,
      checks: checks.value.map(c => c.name),
      timestamp: Date.now(),
    }
    localStorage.setItem('triageContext', JSON.stringify(ctx))
  }
  router.push('/hospital')
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

/* 严重程度头部 */
.severity-banner {
  display: flex;
  align-items: center;
  padding: var(--spacing-lg) var(--spacing-md);
  color: white;
}
.severity-icon {
  font-size: 36px;
  margin-right: var(--spacing-md);
}
.severity-text h2 {
  font-size: var(--font-size-xl);
  font-weight: 700;
}
.severity-text p {
  font-size: var(--font-size-sm);
  opacity: 0.9;
  margin-top: 4px;
}

/* 卡片 */
.card {
  background: var(--color-white);
  border-radius: var(--radius-md);
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.card-danger {
  border: 1px solid var(--color-visit-today);
  background: #FFF2F0;
}
.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: var(--spacing-md);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.card-icon {
  font-size: 18px;
}

.dept-name {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-primary);
}
.dept-level {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* 清单 */
.checklist-section {
  margin-bottom: var(--spacing-md);
}
.checklist-section:last-child {
  margin-bottom: 0;
}
.section-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
  margin-bottom: var(--spacing-sm);
  font-weight: 500;
}
.summary-box {
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-md);
  line-height: 1.6;
  color: var(--color-text);
}
.check-item {
  display: flex;
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border);
  gap: var(--spacing-sm);
}
.check-item:last-child {
  border-bottom: none;
}
.check-name {
  flex: 1;
  font-size: var(--font-size-md);
}
.check-price {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  min-width: 80px;
  text-align: right;
}
.check-priority {
  font-size: var(--font-size-xs);
  min-width: 50px;
  text-align: right;
}
.check-priority.required { color: var(--color-primary); }
.check-priority.optional { color: var(--color-text-hint); }

.script-box {
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-md);
  color: var(--color-primary);
  line-height: 1.6;
  font-style: italic;
}

/* 方向 */
.direction-item {
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border);
}
.direction-item:last-child { border-bottom: none; }
.direction-name {
  font-size: var(--font-size-md);
  font-weight: 500;
}
.direction-note {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 2px;
}

/* 列表 */
.care-list, .red-flags-list {
  padding-left: var(--spacing-md);
}
.care-list li, .red-flags-list li {
  font-size: var(--font-size-md);
  line-height: 1.8;
  color: var(--color-text-secondary);
}
.red-flags-list li {
  color: var(--color-visit-today);
}

/* 操作按钮 */
.actions {
  padding: var(--spacing-lg) var(--spacing-md);
  padding-bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom));
}
</style>
