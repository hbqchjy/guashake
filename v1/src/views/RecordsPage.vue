<template>
  <div class="page">
    <van-nav-bar title="就诊记录" left-arrow @click-left="$router.back()" />

    <van-empty v-if="!loading && !records.length" description="暂无就诊记录" />

    <div class="context-banner" v-if="contextMode">
      <div class="context-title">发送到当前对话</div>
      <div class="context-desc">选一条历史记录，把它作为这次问诊的补充上下文。</div>
    </div>

    <div class="records-list" v-if="records.length">
      <div
        class="record-card card"
        v-for="record in records"
        :key="record.id"
        @click="contextMode ? sendToContext(record) : goDetail(record)"
      >
        <div class="record-header">
          <span class="record-dept">{{ record.likelyType || record.department || '历史分析' }}</span>
          <van-tag :type="severityTagType(record)" size="medium">
            {{ record.severityText || '待评估' }}
          </van-tag>
        </div>
        <p class="record-complaint">{{ record.chiefComplaint || record.summary || '暂无描述' }}</p>
        <div class="record-footer">
          <span class="record-date">{{ formatDate(record.createdAt) }}</span>
          <van-button
            v-if="contextMode"
            size="small"
            round
            plain
            type="primary"
            :loading="sendingId === record.id"
            @click.stop="sendToContext(record)"
          >
            发送到当前对话
          </van-button>
          <van-icon v-else name="arrow" color="#ccc" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showToast } from 'vant'
import { getArchiveList, getArchiveContext, createArchiveContextSession, sendTriageSupplement } from '../api'

const router = useRouter()
const route = useRoute()
const records = ref([])
const loading = ref(true)
const sendingId = ref('')
const contextMode = computed(() => String(route.query.mode || '') === 'context')
const currentSessionId = computed(() => String(route.query.sessionId || '').trim())

onMounted(async () => {
  const userId = localStorage.getItem('userId')
  if (!userId) {
    loading.value = false
    return
  }
  try {
    const res = await getArchiveList(userId)
    records.value = res.records || res || []
  } catch { /* ignore */ }
  loading.value = false
})

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function severityTagType(record) {
  const s = record.severity || ''
  if (s === 'emergency' || s === 'visit_today') return 'danger'
  if (s === 'visit_soon') return 'warning'
  if (s === 'self_treat') return 'primary'
  return 'success'
}

function goDetail(record) {
  if (record.sessionId) {
    router.push(`/result/${record.sessionId}`)
  }
}

async function sendToContext(record) {
  const userId = localStorage.getItem('userId')
  if (!userId) {
    showToast('请先登录后再使用记录')
    router.push('/login')
    return
  }
  sendingId.value = record.id
  try {
    if (!currentSessionId.value) {
      const data = await createArchiveContextSession(userId, record.id)
      localStorage.setItem('currentSessionId', data.sessionId)
      localStorage.setItem('currentComplaint', data.sourceRecord?.chiefComplaint || record.chiefComplaint || record.summary || '')
      sessionStorage.setItem('triageResumeNotice', '已把一条历史记录并入这次咨询，你可以继续补充，或者直接更新分析。')
      router.push({
        path: '/triage',
        query: {
          sessionId: data.sessionId,
          mode: data.nextQuestion ? 'structured' : 'supplement',
          title: data.sourceRecord?.likelyType || record.likelyType || record.summary || '',
          source: 'record',
        },
      })
      return
    }

    const contextData = await getArchiveContext(userId, record.id)
    const supplementResult = await sendTriageSupplement({
      sessionId: currentSessionId.value,
      supplement: contextData.contextText || record.summary || record.chiefComplaint || '历史记录补充',
    })

    if (supplementResult.forceImmediateResult) {
      router.push(`/result/${currentSessionId.value}`)
      return
    }

    sessionStorage.setItem(
      'triageResumeNotice',
      supplementResult.refreshSummary || supplementResult.affectsSummary || supplementResult.canRefreshSummary
        ? '历史记录已并入当前咨询，你可以继续补充，或者现在更新分析。'
        : '历史记录已并入当前咨询，你可以继续补充新的信息。',
    )
    router.push({
      path: '/triage',
      query: {
        sessionId: currentSessionId.value,
        mode: 'supplement',
        title: record.likelyType || record.summary || record.chiefComplaint || '',
        source: 'record',
      },
    })
  } catch {
    showToast('引用历史记录失败')
  } finally {
    sendingId.value = ''
  }
}
</script>

<style scoped>
.context-banner {
  margin: var(--spacing-md);
  margin-bottom: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f5fbf8;
  border: 1px solid rgba(0, 181, 120, 0.12);
}
.context-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-primary-deep);
}
.context-desc {
  margin-top: 4px;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.records-list {
  padding: var(--spacing-sm) 0;
}
.record-card {
  cursor: pointer;
}
.record-card:active {
  background: #f9f9f9;
}
.record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
}
.record-dept {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}
.record-complaint {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: var(--spacing-sm);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.record-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.record-date {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
}
</style>
