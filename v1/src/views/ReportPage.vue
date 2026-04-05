<template>
  <div class="page">
    <van-nav-bar title="我看完了" left-arrow @click-left="$router.back()" />

    <!-- 分诊上下文横幅 -->
    <div class="context-banner" v-if="triageCtx">
      <span class="context-icon">&#x1F4CB;</span>
      <div class="context-info">
        <p>你之前因为「{{ triageCtx.complaint }}」向小科做过分析，这次结果可以继续接着看。</p>
      </div>
    </div>

    <div class="content">
      <!-- 说明 -->
      <div class="hint-card" v-if="!result && !loading">
        <p>&#x1F4CA; 你可以上传这次在医院做的检验单、报告单，也可以补充医生开的药和医生交代的内容。小科会帮你看懂结果重点，告诉你现在该怎么处理，后面要不要复查或复诊。</p>
      </div>

      <!-- 上传 -->
      <div class="upload-area" v-if="!loading && !result">
        <label class="upload-box">
          <van-icon name="photograph" size="36" color="var(--color-primary)" />
          <p class="upload-text">拍摄/上传检验报告</p>
          <p class="upload-hint">拍照时注意光线充足，尽量拍完整</p>
          <input type="file" accept="image/*" capture="environment" @change="onFileChange" hidden />
        </label>
      </div>

      <!-- 加载 -->
      <div class="loading-area" v-if="loading">
        <van-loading size="24px" vertical>正在解读报告...</van-loading>
        <p class="loading-hint">AI 正在逐项分析，通常需要 15-30 秒</p>
      </div>

      <!-- 结果 -->
      <template v-if="result && result.analysis">
        <!-- 总体状况 -->
        <div class="overview-card" :class="overviewClass">
          <div class="overview-icon">{{ overviewIcon }}</div>
          <div class="overview-info">
            <h3>{{ result.analysis.reportType || '检验报告' }}</h3>
            <p>{{ result.analysis.overallStatus || '分析完成' }}
              <span v-if="result.analysis.abnormalCount">，{{ result.analysis.abnormalCount }} 项需关注</span>
            </p>
          </div>
        </div>

        <!-- 指标列表 -->
        <div class="card" v-if="result.analysis.items?.length">
          <div class="card-title">&#x1F4CA; 指标详情</div>
          <div
            class="indicator-item"
            v-for="(item, i) in result.analysis.items"
            :key="i"
            :class="{ abnormal: item.status !== '正常' }"
          >
            <div class="indicator-header">
              <span class="indicator-name">{{ item.name }}</span>
              <span class="indicator-status" :class="statusClass(item.status)">
                {{ statusIcon(item.status) }} {{ item.status }}
              </span>
            </div>
            <div class="indicator-values">
              <span class="indicator-value">{{ item.value }} {{ item.unit || '' }}</span>
              <span class="indicator-ref" v-if="item.reference">参考：{{ item.reference }}</span>
            </div>
            <p class="indicator-explain" v-if="item.explanation">
              {{ item.explanation }}
            </p>
          </div>
        </div>

        <!-- 总结 -->
        <div class="card" v-if="result.analysis.summary">
          <div class="card-title">&#x1F4DD; 简明总结</div>
          <p class="summary-text">{{ result.analysis.summary }}</p>
        </div>

        <!-- 建议 -->
        <div class="card" v-if="result.analysis.suggestions?.length">
          <div class="card-title">&#x1F4A1; 建议</div>
          <ul class="suggestion-list">
            <li v-for="(s, i) in result.analysis.suggestions" :key="i">{{ s }}</li>
          </ul>
        </div>

        <!-- 复诊提醒 -->
        <div class="card followup-card" v-if="result.analysis.followUpDays > 0">
          <div class="followup-content">
            <span class="followup-icon">&#x1F4C5;</span>
            <div class="followup-info">
              <h4>建议 {{ result.analysis.followUpDays }} 天后复查</h4>
              <p>到时候记得带上这份报告</p>
            </div>
          </div>
        </div>

        <!-- 免责 -->
        <div class="disclaimer">
          <p>{{ result.disclaimer || '以上解读仅供参考，具体诊断请咨询医生。' }}</p>
        </div>

        <!-- 操作 -->
        <div class="actions">
          <van-button block round type="primary" @click="saveScreenshot">
            &#x1F4F1; 截图保存
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

// 读取分诊上下文
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

const overviewClass = computed(() => {
  const count = result.value?.analysis?.abnormalCount || 0
  if (count === 0) return 'overview-good'
  if (count <= 2) return 'overview-warn'
  return 'overview-alert'
})

const overviewIcon = computed(() => {
  const count = result.value?.analysis?.abnormalCount || 0
  if (count === 0) return '\u2705'
  if (count <= 2) return '\u26A0\uFE0F'
  return '\u{1F534}'
})

function statusClass(status) {
  if (status === '正常') return 'status-normal'
  if (status === '偏高' || status === '偏低') return 'status-warn'
  return 'status-alert'
}

function statusIcon(status) {
  if (status === '正常') return '\u2705'
  if (status === '偏高') return '\u2B06\uFE0F'
  if (status === '偏低') return '\u2B07\uFE0F'
  return '\u26A0\uFE0F'
}

function reset() { result.value = null }

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
}
.upload-box:active { border-color: var(--color-primary); }
.upload-text { font-size: var(--font-size-md); font-weight: 500; margin-top: var(--spacing-sm); }
.upload-hint { font-size: var(--font-size-xs); color: var(--color-text-hint); margin-top: 4px; }

/* 加载 */
.loading-area { text-align: center; padding: 60px var(--spacing-md); }
.loading-hint { font-size: var(--font-size-xs); color: var(--color-text-hint); margin-top: var(--spacing-md); }

/* 总览 */
.overview-card {
  display: flex;
  align-items: center;
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  gap: var(--spacing-md);
}
.overview-good { background: #F6FFED; border: 1px solid #B7EB8F; }
.overview-warn { background: #FFFBE6; border: 1px solid #FFE58F; }
.overview-alert { background: #FFF2F0; border: 1px solid #FFCCC7; }
.overview-icon { font-size: 32px; }
.overview-info h3 { font-size: var(--font-size-lg); font-weight: 600; }
.overview-info p { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: 2px; }

/* 卡片 */
.card {
  background: var(--color-white);
  border-radius: var(--radius-md);
  margin: var(--spacing-md);
  padding: var(--spacing-md);
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.card-title { font-size: var(--font-size-lg); font-weight: 600; margin-bottom: var(--spacing-md); }

/* 指标 */
.indicator-item {
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border);
}
.indicator-item:last-child { border-bottom: none; }
.indicator-item.abnormal {
  background: #FFFBE6;
  margin: 0 calc(var(--spacing-md) * -1);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
}
.indicator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.indicator-name { font-size: var(--font-size-md); font-weight: 500; }
.indicator-status { font-size: var(--font-size-xs); padding: 2px 8px; border-radius: 10px; }
.status-normal { background: #E8F8F0; color: var(--color-primary); }
.status-warn { background: #FFF7E6; color: #D48806; }
.status-alert { background: #FFF2F0; color: var(--color-visit-today); }
.indicator-values {
  display: flex;
  gap: var(--spacing-md);
  margin-top: 4px;
}
.indicator-value { font-size: var(--font-size-md); color: var(--color-text); font-weight: 600; }
.indicator-ref { font-size: var(--font-size-xs); color: var(--color-text-hint); }
.indicator-explain {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 4px;
  line-height: 1.5;
  padding-left: var(--spacing-sm);
  border-left: 2px solid var(--color-visit-soon);
}

/* 总结 */
.summary-text { font-size: var(--font-size-md); line-height: 1.6; color: var(--color-text); }
.suggestion-list { padding-left: var(--spacing-md); }
.suggestion-list li { font-size: var(--font-size-md); line-height: 1.8; color: var(--color-text-secondary); }

/* 复诊 */
.followup-card { background: #E6F7FF; border: 1px solid #91D5FF; }
.followup-content { display: flex; align-items: center; gap: var(--spacing-md); }
.followup-icon { font-size: 28px; }
.followup-info h4 { font-size: var(--font-size-md); font-weight: 600; color: #096DD9; }
.followup-info p { font-size: var(--font-size-sm); color: #69B1FF; margin-top: 2px; }

/* 免责 */
.disclaimer { text-align: center; padding: var(--spacing-md); }
.disclaimer p { font-size: var(--font-size-xs); color: var(--color-text-hint); }

.actions {
  padding: var(--spacing-md);
  padding-bottom: calc(var(--spacing-lg) + env(safe-area-inset-bottom));
}
</style>
