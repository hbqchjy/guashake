<template>
  <div class="page">
    <van-nav-bar title="就诊记录" left-arrow @click-left="$router.back()" />

    <van-empty v-if="!loading && !records.length" description="暂无就诊记录" />

    <div class="records-list" v-if="records.length">
      <div
        class="record-card card"
        v-for="record in records"
        :key="record.id"
        @click="goDetail(record)"
      >
        <div class="record-header">
          <span class="record-dept">{{ record.department || '待分诊' }}</span>
          <van-tag :type="severityTagType(record)" size="medium">
            {{ record.severityText || '待评估' }}
          </van-tag>
        </div>
        <p class="record-complaint">{{ record.chiefComplaint || record.summary || '暂无描述' }}</p>
        <div class="record-footer">
          <span class="record-date">{{ formatDate(record.createdAt) }}</span>
          <van-icon name="arrow" color="#ccc" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getArchiveList } from '../api'

const router = useRouter()
const records = ref([])
const loading = ref(true)

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
</script>

<style scoped>
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
