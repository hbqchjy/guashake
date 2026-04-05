<template>
  <div class="page home-page">
    <!-- 顶部 -->
    <header class="home-header">
      <div class="header-left">
        <h1 class="app-title">小科</h1>
        <p class="app-subtitle">看病前判断方向，看病中少走弯路，看病后看懂结果。</p>
      </div>
      <div class="header-right" @click="goLogin">
        <span class="user-nick" v-if="nickname">{{ nickname }}</span>
        <van-icon name="user-circle-o" size="28" color="#666" />
      </div>
    </header>

    <!-- 三阶段入口 -->
    <section class="stage-section">
      <p class="stage-hint">你现在处于哪个阶段？</p>

      <div class="stage-card stage-pre" @click="goTriage">
        <div class="stage-icon stage-icon-pre">
          <van-icon name="warning-o" size="24" />
        </div>
        <div class="stage-info">
          <h3>我不舒服</h3>
          <p>评估症状轻重，提供观察、用药与就医参考。</p>
        </div>
        <van-icon name="arrow" class="stage-arrow" />
      </div>

      <div class="stage-card stage-during" @click="goHospital">
        <div class="stage-icon stage-icon-during">
          <van-icon name="records-o" size="24" />
        </div>
        <div class="stage-info">
          <h3>我在医院</h3>
          <p>梳理病情重点，辅助医患沟通，解读检查、处方，帮助减少不必要支出。</p>
        </div>
        <van-icon name="arrow" class="stage-arrow" />
      </div>

      <div class="stage-card stage-post" @click="goReport">
        <div class="stage-icon stage-icon-post">
          <van-icon name="description" size="24" />
        </div>
        <div class="stage-info">
          <h3>我看完了</h3>
          <p>通俗解读报告结果，说明异常意义，并提供后续处理与复查建议。</p>
        </div>
        <van-icon name="arrow" class="stage-arrow" />
      </div>
    </section>

    <!-- 最近记录 - 骨架屏 -->
    <section class="records-section" v-if="loadingRecords">
      <div class="section-header">
        <span class="section-title">最近记录</span>
      </div>
      <div class="record-card skeleton" v-for="n in 2" :key="n">
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
      </div>
    </section>

    <!-- 最近记录 - 实际内容 -->
    <section class="records-section" v-if="!loadingRecords && recentRecords.length">
      <div class="section-header">
        <span class="section-title">最近记录</span>
        <span class="section-more" @click="goRecords">查看全部</span>
      </div>
      <div
        class="record-card"
        v-for="record in recentRecords"
        :key="record.id"
        @click="goResult(record)"
      >
        <div class="record-top">
          <span class="record-dept">{{ record.department || '待分诊' }}</span>
          <span class="record-date">{{ formatDate(record.createdAt) }}</span>
        </div>
        <p class="record-summary">{{ record.summaryText || record.summary || record.chiefComplaint || '暂无摘要' }}</p>
      </div>
    </section>

    <!-- 免责声明 -->
    <footer class="home-footer">
      <p>本工具仅提供就医信息参考，不构成医疗建议</p>
      <p>紧急情况请立即拨打 <a href="tel:120">120</a></p>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getArchiveList } from '../api'

const router = useRouter()
const recentRecords = ref([])
const loadingRecords = ref(false)
const nickname = ref(localStorage.getItem('nickname') || '')

onMounted(async () => {
  const userId = localStorage.getItem('userId')
  if (userId) {
    loadingRecords.value = true
    try {
      const res = await getArchiveList(userId)
      recentRecords.value = (res.records || res || []).slice(0, 3)
    } catch { /* ignore */ }
    loadingRecords.value = false
  }
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function goTriage() { router.push('/triage') }
function goHospital() { router.push('/hospital') }
function goReport() { router.push('/report') }
function goRecords() { router.push('/records') }
function goLogin() { router.push('/login') }
function goResult(record) {
  if (record.sessionId) {
    router.push(`/result/${record.sessionId}`)
  }
}
</script>

<style scoped>
.home-page {
  background: var(--color-bg);
  min-height: 100vh;
}

/* 顶部 */
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-lg) var(--spacing-md) var(--spacing-md);
  background: var(--color-white);
}
.app-title {
  font-size: var(--font-size-xxl);
  font-weight: 700;
  color: var(--color-primary);
}
.app-subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
  margin-top: 2px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacing-sm);
  cursor: pointer;
}
.user-nick {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 三入口 */
.stage-section {
  padding: var(--spacing-lg) var(--spacing-md) var(--spacing-md);
}
.stage-hint {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: var(--spacing-md);
}
.stage-card {
  display: flex;
  align-items: flex-start;
  background: var(--color-white);
  border-radius: var(--radius-md);
  padding: var(--spacing-md) var(--spacing-md);
  margin-bottom: var(--spacing-sm);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: transform 0.15s ease;
  border-left: 4px solid transparent;
}
.stage-card:active {
  transform: scale(0.98);
}
.stage-pre { border-left-color: var(--color-visit-soon); }
.stage-during { border-left-color: var(--color-self-treat); }
.stage-post { border-left-color: var(--color-primary); }

.stage-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  margin-right: 14px;
  margin-top: 2px;
}
.stage-icon-pre { background: linear-gradient(135deg, #ffb84d, #ff8f1f); }
.stage-icon-during { background: linear-gradient(135deg, #19a0ff, #1677ff); }
.stage-icon-post { background: linear-gradient(135deg, #15bf7a, #00b578); }
.stage-info {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}
.stage-info h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}
.stage-info p {
  position: relative;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 6px;
  line-height: 1.65;
  padding-left: 12px;
}
.stage-info p::before {
  content: '·';
  position: absolute;
  left: 0;
  top: 0;
  color: var(--color-primary);
  font-weight: 700;
}
.stage-arrow {
  color: var(--color-text-hint);
  flex-shrink: 0;
  margin-left: 12px;
  margin-top: 12px;
}

/* 最近记录 */
.records-section {
  padding: var(--spacing-md);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
}
.section-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}
.section-more {
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  cursor: pointer;
}
.record-card {
  background: var(--color-white);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
  cursor: pointer;
}
.record-card:active {
  background: #f5f5f5;
}
.record-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
}
.record-dept {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-primary);
}
.record-date {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
}
.record-summary {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 底部免责 */
.home-footer {
  text-align: center;
  padding: var(--spacing-xl) var(--spacing-md);
  padding-bottom: calc(var(--spacing-xl) + env(safe-area-inset-bottom));
}
.home-footer p {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
  line-height: 1.8;
}
.home-footer a {
  color: var(--color-visit-today);
  text-decoration: none;
  font-weight: 600;
}

/* 骨架屏 */
.record-card.skeleton {
  background: var(--color-white);
  border-radius: var(--radius-sm);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
}
.skeleton-line {
  height: 14px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 8px;
}
.skeleton-line:last-child { margin-bottom: 0; }
.skeleton-line.short { width: 40%; }
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
