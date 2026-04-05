<template>
  <div class="page">
    <van-nav-bar title="我在医院" left-arrow @click-left="$router.back()" />

    <!-- 功能选择 -->
    <div class="tab-bar">
      <div
        class="tab-item"
        :class="{ active: mode === 'check' }"
        @click="switchMode('check')"
      >
        <span class="tab-icon">&#x1F4CB;</span>
        <span>检查单分析</span>
      </div>
      <div
        class="tab-item"
        :class="{ active: mode === 'prescription' }"
        @click="switchMode('prescription')"
      >
        <span class="tab-icon">&#x1F48A;</span>
        <span>处方分析</span>
      </div>
    </div>

    <!-- 分诊上下文横幅 -->
    <div class="context-banner" v-if="triageCtx">
      <span class="context-icon">&#x1F4CB;</span>
      <div class="context-info">
        <p>你之前因为「{{ triageCtx.complaint }}」被建议挂 <strong>{{ triageCtx.department }}</strong></p>
      </div>
    </div>

    <div class="content">
      <!-- 说明文字 -->
      <div class="hint-card" v-if="!result && !loading">
        <p v-if="mode === 'check'">
          拍下医生开的检查单，帮你看哪些检查必要，哪些可以先不做，预估能省多少钱。
        </p>
        <p v-else>
          拍下处方，帮你了解每种药的作用和必要性，标出辅助用药和自费药。
        </p>
      </div>

      <!-- 上传区域 -->
      <div class="upload-area" v-if="!loading && !result">
        <label class="upload-box">
          <van-icon name="photograph" size="36" color="var(--color-primary)" />
          <p class="upload-text">{{ mode === 'check' ? '拍摄/上传检查单' : '拍摄/上传处方' }}</p>
          <p class="upload-hint">支持拍照或从相册选取</p>
          <input type="file" accept="image/*" capture="environment" @change="onFileChange" hidden />
        </label>
      </div>

      <!-- 加载中 -->
      <div class="loading-area" v-if="loading">
        <van-loading size="24px" vertical>
          {{ mode === 'check' ? '正在分析检查单...' : '正在分析处方...' }}
        </van-loading>
        <p class="loading-hint">AI 正在识别和分析，通常需要 10-20 秒</p>
      </div>

      <!-- 检查单分析结果 -->
      <template v-if="result && mode === 'check'">
        <div class="card" v-if="result.analysis?.items?.length">
          <div class="card-title">&#x1F4CB; 检查项目分析</div>
          <div class="check-table">
            <div
              class="check-row"
              v-for="(item, i) in result.analysis.items"
              :key="i"
            >
              <span class="check-name">{{ item.name }}</span>
              <span class="check-price">{{ item.priceRange || '' }}</span>
              <span class="check-badge" :class="priorityClass(item.priority)">
                {{ priorityLabel(item.priority) }}
              </span>
            </div>
          </div>
        </div>

        <div class="card" v-if="result.analysis?.script">
          <div class="card-title">&#x1F4AC; 可以对医生说</div>
          <div class="script-box">"{{ result.analysis.script }}"</div>
        </div>

        <div class="card saving-card" v-if="result.analysis?.savingEstimate">
          <div class="saving-text">
            &#x1F4B0; 本次可能节省约：<strong>{{ result.analysis.savingEstimate }}</strong>
          </div>
        </div>

        <div class="card" v-if="result.analysis?.note">
          <div class="card-title">&#x1F4A1; 整体建议</div>
          <p class="note-text">{{ result.analysis.note }}</p>
        </div>
      </template>

      <!-- 处方分析结果 -->
      <template v-if="result && mode === 'prescription'">
        <div class="card" v-if="result.analysis?.medicines?.length">
          <div class="card-title">&#x1F48A; 药品分析</div>
          <div
            class="medicine-item"
            v-for="(med, i) in result.analysis.medicines"
            :key="i"
          >
            <div class="med-header">
              <span class="med-name">{{ med.name }}</span>
              <span class="med-badge" :class="necessityClass(med.necessity)">
                {{ necessityLabel(med.necessity) }}
              </span>
            </div>
            <div class="med-detail">
              <span v-if="med.priceRange" class="med-price">{{ med.priceRange }}</span>
              <van-tag v-if="med.insuranceType" size="small" :type="med.insuranceType === '自费' ? 'danger' : 'primary'">
                {{ med.insuranceType }}
              </van-tag>
              <van-tag v-if="med.category" size="small" plain>{{ med.category }}</van-tag>
            </div>
            <p class="med-reason" v-if="med.reason">{{ med.reason }}</p>
          </div>
        </div>

        <div class="card" v-if="result.analysis?.script">
          <div class="card-title">&#x1F4AC; 可以问医生</div>
          <div class="script-box">"{{ result.analysis.script }}"</div>
        </div>

        <div class="card" v-if="result.analysis?.interactions">
          <div class="card-title">&#x26A0;&#xFE0F; 用药提醒</div>
          <p class="note-text">{{ result.analysis.interactions }}</p>
        </div>

        <div class="card" v-if="result.analysis?.note">
          <div class="card-title">&#x1F4A1; 整体建议</div>
          <p class="note-text">{{ result.analysis.note }}</p>
        </div>
      </template>

      <!-- 免责声明 -->
      <div class="disclaimer" v-if="result">
        <p>{{ result.disclaimer || '以上分析仅供参考，具体请遵医嘱。' }}</p>
      </div>

      <!-- 重新上传 -->
      <div class="actions" v-if="result">
        <van-button block round plain type="primary" @click="reset">
          重新上传分析
        </van-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { showToast } from 'vant'
import { analyzeCheckSheet, analyzePrescription } from '../api'

const mode = ref('check')
const loading = ref(false)
const result = ref(null)

// 读取分诊上下文
const triageCtx = ref(null)
try {
  const raw = localStorage.getItem('triageContext')
  if (raw) {
    const ctx = JSON.parse(raw)
    // 只使用 24 小时内的上下文
    if (Date.now() - ctx.timestamp < 30 * 24 * 60 * 60 * 1000 && ctx.complaint) {
      triageCtx.value = ctx
    }
  }
} catch { /* ignore */ }

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
    // 传入分诊上下文
    const context = triageCtx.value
      ? `患者因「${triageCtx.value.complaint}」就诊，推荐科室：${triageCtx.value.department}，症状摘要：${triageCtx.value.summaryForDoctor || '无'}`
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

function priorityClass(p) {
  if (p === '必要') return 'priority-required'
  if (p === '可等') return 'priority-optional'
  return 'priority-ask'
}
function priorityLabel(p) {
  if (p === '必要') return '\u2705 先做'
  if (p === '可等') return '\u23F8 可等'
  return '\u2753 问医生'
}

function necessityClass(n) {
  if (n === '核心') return 'necessity-core'
  if (n === '辅助') return 'necessity-aux'
  return 'necessity-limited'
}
function necessityLabel(n) {
  if (n === '核心') return '\u2705 核心'
  if (n === '辅助') return '\u26A0\uFE0F 辅助'
  return '\u2753 证据有限'
}
</script>

<style scoped>
/* 分诊上下文横幅 */
.context-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px var(--spacing-md);
  background: #E6F7FF;
  border-bottom: 1px solid #91D5FF;
}
.context-icon { font-size: 20px; }
.context-info p {
  font-size: var(--font-size-sm);
  color: #096DD9;
  line-height: 1.4;
}
.context-info strong { font-weight: 600; }

/* Tab 切换 */
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
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.tab-item.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}
.tab-icon { font-size: 18px; }

.content { padding: var(--spacing-md) 0; }

/* 提示 */
.hint-card {
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
}
.hint-card p {
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  line-height: 1.6;
}

/* 上传 */
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
  cursor: pointer;
  transition: border-color 0.2s;
}
.upload-box:active { border-color: var(--color-primary); }
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

/* 加载 */
.loading-area {
  text-align: center;
  padding: 60px var(--spacing-md);
}
.loading-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
  margin-top: var(--spacing-md);
}

/* 卡片 */
.card {
  background: var(--color-white);
  border-radius: var(--radius-md);
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin-bottom: var(--spacing-md);
}

/* 检查单表格 */
.check-row {
  display: flex;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  gap: var(--spacing-sm);
}
.check-row:last-child { border-bottom: none; }
.check-name { flex: 1; font-size: var(--font-size-md); }
.check-price {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  min-width: 70px;
  text-align: right;
}
.check-badge {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.priority-required { background: #E8F8F0; color: var(--color-primary); }
.priority-optional { background: #F0F0F0; color: var(--color-text-hint); }
.priority-ask { background: #FFF7E6; color: #D48806; }

/* 处方药品 */
.medicine-item {
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border);
}
.medicine-item:last-child { border-bottom: none; }
.med-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.med-name { font-size: var(--font-size-md); font-weight: 500; }
.med-badge {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 10px;
}
.necessity-core { background: #E8F8F0; color: var(--color-primary); }
.necessity-aux { background: #FFF7E6; color: #D48806; }
.necessity-limited { background: #FFF2F0; color: var(--color-visit-today); }
.med-detail {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  margin-top: 4px;
}
.med-price { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.med-reason {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

/* ���术 */
.script-box {
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-md);
  color: var(--color-primary);
  line-height: 1.6;
  font-style: italic;
}

/* 节省 */
.saving-card {
  background: #F6FFED;
  border: 1px solid #B7EB8F;
}
.saving-text {
  font-size: var(--font-size-md);
  color: #389E0D;
}
.saving-text strong { font-size: var(--font-size-lg); }

.note-text {
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

/* 免责 */
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
}
</style>
