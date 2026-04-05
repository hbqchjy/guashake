<template>
  <div class="page triage-page">
    <van-nav-bar title="症状分诊" left-arrow @click-left="$router.push('/')" />

    <!-- 进度条 -->
    <div class="progress-bar" v-if="step > 0 && totalSteps > 0">
      <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      <span class="progress-text">第 {{ step }} / {{ totalSteps }} 步</span>
    </div>

    <!-- 对话区域 -->
    <div class="chat-area" ref="chatArea">
      <!-- 快速症状选择（未开始对话时） -->
      <div class="quick-symptoms" v-if="stage === 'init'">
        <div class="chat-bubble bot">
          <div class="bubble-content">
            <div class="bot-avatar"><span>&#x1F469;&#x200D;&#x2695;&#xFE0F;</span></div>
            <div class="bot-text">
              <p>你好，我是小科。告诉我你哪里不舒服，或者点击下方常见症状快速开始。</p>
            </div>
          </div>
        </div>
        <div class="symptom-groups">
          <div class="symptom-group" v-for="group in symptomGroups" :key="group.label">
            <div class="group-label">{{ group.label }}</div>
            <div class="group-chips">
              <span
                class="symptom-chip"
                v-for="item in group.items"
                :key="item"
                @click="quickStart(item)"
              >{{ item }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 对话消息 -->
      <div
        class="chat-bubble"
        v-for="(msg, i) in messages"
        :key="i"
        :class="msg.role"
      >
        <div class="bubble-content" v-if="msg.role === 'bot'">
          <div class="bot-avatar"><span>&#x1F469;&#x200D;&#x2695;&#xFE0F;</span></div>
          <div class="bot-text">
            <p v-html="msg.text"></p>
            <div class="options" v-if="msg.options && msg.isLatest && !loading">
              <button
                class="option-btn"
                v-for="opt in msg.options"
                :key="opt.value || opt"
                @click="selectOption(opt)"
              >{{ opt.label || opt }}</button>
            </div>
          </div>
        </div>
        <div class="bubble-content user-content" v-else>
          <div class="user-text">{{ msg.text }}</div>
        </div>
      </div>

      <!-- 打字动画 -->
      <div class="chat-bubble bot" v-if="loading">
        <div class="bubble-content">
          <div class="bot-avatar"><span>&#x1F469;&#x200D;&#x2695;&#xFE0F;</span></div>
          <div class="bot-text">
            <div class="typing-dots"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area" v-if="showInput">
      <div class="input-row">
        <van-field
          v-model="inputText"
          :placeholder="inputPlaceholder"
          type="textarea"
          rows="1"
          autosize
          @keydown.enter.exact.prevent="sendText"
        />
        <van-button
          type="primary"
          size="small"
          round
          :disabled="!inputText.trim() || loading"
          @click="sendText"
        >发送</van-button>
      </div>
      <div class="input-actions">
        <label class="upload-btn" v-if="sessionId">
          <van-icon name="photograph" size="20" />
          <span>拍照上传</span>
          <input type="file" accept="image/*" capture="environment" @change="uploadFile" hidden />
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import {
  createTriageSession,
  answerTriageQuestion,
  sendTriageMessage,
  sendTriageSupplement,
  uploadTriageFile,
} from '../api'

const router = useRouter()
const chatArea = ref(null)

const sessionId = ref('')
const messages = ref([])
const inputText = ref('')
const loading = ref(false)
const step = ref(0)
const totalSteps = ref(0)
const stage = ref('init') // init, open, structured, done
const showInput = ref(true)
const currentQuestionId = ref('')

const symptomGroups = [
  { label: '疼痛类', items: ['头痛', '腹痛', '腰酸腰痛', '胸闷', '胸痛', '咽喉痛', '关节痛', '颈肩痛'] },
  { label: '消化与排泄', items: ['胃不舒服', '腹泻', '便秘', '反酸烧心', '恶心想吐', '尿频尿急', '血尿'] },
  { label: '呼吸与五官', items: ['咳嗽', '发热', '气短', '呼吸困难', '鼻塞流涕', '耳痛耳鸣'] },
  { label: '神经与循环', items: ['头晕', '心慌', '失眠', '焦虑心烦', '高热不退'] },
  { label: '其他', items: ['月经异常', '皮肤红疹', '肛门坠胀', '检查报告解读'] },
]

const inputPlaceholder = computed(() => {
  if (stage.value === 'init') return '描述一下你哪里不舒服...'
  if (stage.value === 'open') return '继续描述你的情况...'
  return '补充说明...'
})

const progressPercent = computed(() => {
  if (totalSteps.value <= 0) return 0
  return Math.min((step.value / totalSteps.value) * 100, 100)
})

function addBotMessage(text, options = []) {
  messages.value.forEach(m => { if (m.role === 'bot') m.isLatest = false })
  messages.value.push({ role: 'bot', text, options, isLatest: true })
  scrollBottom()
}

function addUserMessage(text) {
  messages.value.push({ role: 'user', text })
  scrollBottom()
}

async function scrollBottom() {
  await nextTick()
  if (chatArea.value) chatArea.value.scrollTop = chatArea.value.scrollHeight
}

// ── 快速开始 ──
function quickStart(symptom) {
  stage.value = 'starting'
  addUserMessage(symptom)
  startSession(symptom)
}

// ── 发送文字 ──
async function sendText() {
  const text = inputText.value.trim()
  if (!text || loading.value) return
  inputText.value = ''
  addUserMessage(text)

  if (stage.value === 'init') {
    stage.value = 'starting'
    await startSession(text)
  } else if (stage.value === 'open') {
    await continueOpen(text)
  } else if (stage.value === 'structured') {
    await supplement(text)
  }
}

// ── 1. 创建会话 ──
async function startSession(complaint) {
  loading.value = true
  try {
    const res = await createTriageSession({ chiefComplaint: complaint })
    sessionId.value = res.sessionId
    // 保存到 localStorage 供阶段二三使用
    localStorage.setItem('currentSessionId', res.sessionId)
    localStorage.setItem('currentComplaint', complaint)

    stage.value = res.conversationStage || 'structured'

    if (res.conversationStage === 'closed') {
      if (res.assistantReply) addBotMessage(res.assistantReply)
      return
    }

    if (res.immediateResult) {
      if (res.assistantReply) addBotMessage(res.assistantReply)
      goResult()
      return
    }

    // 开放式对话阶段
    if (res.nextPrompt?.type === 'text') {
      stage.value = 'open'
      showInput.value = true
      addBotMessage(res.nextPrompt.text || res.assistantReply)
      return
    }

    // 结构化追问
    if (res.nextQuestion) {
      stage.value = 'structured'
      if (res.assistantReply) addBotMessage(res.assistantReply)
      showQuestion(res)
      return
    }

    // 兜底
    if (res.assistantReply) {
      stage.value = 'open'
      addBotMessage(res.assistantReply)
    }
  } catch (e) {
    addBotMessage('抱歉，系统出了点问题，请稍后再试。')
    stage.value = 'init'
  } finally {
    loading.value = false
  }
}

// ── 2. 开放式对话 ──
async function continueOpen(text) {
  loading.value = true
  try {
    const res = await sendTriageMessage({
      sessionId: sessionId.value,
      message: text,
    })

    // 需要确认→生成结果
    if (res.needsConfirmation) {
      stage.value = 'structured'
      if (res.assistantReply) addBotMessage(res.assistantReply)
      addBotMessage('信息差不多了，要不要现在生成分析结果？', [
        { label: '生成结果', value: '__generate__' },
        { label: '我还想补充', value: '__continue__' },
      ])
      return
    }

    // 直接出结果
    if (res.mode === 'immediate_result') {
      if (res.assistantReply) addBotMessage(res.assistantReply)
      goResult()
      return
    }

    // 转入结构化追问
    if (res.mode === 'question' && res.nextQuestion) {
      stage.value = 'structured'
      if (res.assistantReply) addBotMessage(res.assistantReply)
      else addBotMessage('为了更准确地帮你分析，再回答几个问题。')
      showQuestion(res)
      return
    }

    // 继续开放对话
    if (res.nextPrompt?.type === 'text') {
      stage.value = 'open'
      addBotMessage(res.nextPrompt.text)
      return
    }

    if (res.assistantReply) {
      addBotMessage(res.assistantReply)
    }
  } catch {
    addBotMessage('抱歉，请稍后重试。')
  } finally {
    loading.value = false
  }
}

// ── 3. 结构化追问 ──
function showQuestion(res) {
  const q = res.nextQuestion
  if (!q) return
  currentQuestionId.value = q.id || ''
  step.value = res.progress?.current || step.value + 1
  totalSteps.value = res.progress?.total || totalSteps.value

  const options = (q.options || []).map(opt =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt
  )
  addBotMessage(q.text || q.question, options)
  showInput.value = options.length === 0
}

async function selectOption(opt) {
  const label = opt.label || opt
  const value = opt.value || opt
  addUserMessage(label)

  // 特殊按钮处理
  if (value === '__generate__') {
    goResult()
    return
  }
  if (value === '__continue__') {
    stage.value = 'open'
    showInput.value = true
    addBotMessage('好的，继续说说你的情况。')
    return
  }

  loading.value = true
  showInput.value = false

  try {
    const res = await answerTriageQuestion({
      sessionId: sessionId.value,
      answer: value,
      questionId: currentQuestionId.value,
    })

    // 追问完毕
    if (res.complete || res.followUp?.completed) {
      goResult()
      return
    }

    // 还有下一题
    if (res.nextQuestion) {
      showQuestion(res)
    } else if (res.assistantReply) {
      addBotMessage(res.assistantReply)
      showInput.value = true
    }
  } catch {
    addBotMessage('抱歉，请稍后重试。')
    showInput.value = true
  } finally {
    loading.value = false
  }
}

// ── 4. 补充信息 ──
async function supplement(text) {
  loading.value = true
  try {
    const res = await sendTriageSupplement({
      sessionId: sessionId.value,
      supplement: text,
    })
    if (res.nextQuestion) {
      showQuestion(res)
    } else if (res.reply) {
      addBotMessage(res.reply)
    } else if (res.assistantReply) {
      addBotMessage(res.assistantReply)
    }
  } catch {
    addBotMessage('抱歉，请稍后重试。')
  } finally {
    loading.value = false
  }
}

// ── 5. 图片上传 ──
async function uploadFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (!sessionId.value) { showToast('请先描述症状'); return }
  addUserMessage(`[上传图片] ${file.name}`)
  loading.value = true
  try {
    const res = await uploadTriageFile(sessionId.value, file)
    const summary = res.file?.summary
    if (summary?.highlights?.length) {
      addBotMessage(`已识别：${summary.highlights.join('、')}`)
    } else {
      addBotMessage('图片已上传，我会参考分析。')
    }
  } catch {
    addBotMessage('图片上传失败，请重试。')
  } finally {
    loading.value = false
    e.target.value = ''
  }
}

// ── 跳转结果 ──
function goResult() {
  stage.value = 'done'
  showInput.value = false
  addBotMessage('分析完成，正在生成结果...')
  // 保存会话信息
  localStorage.setItem('currentSessionId', sessionId.value)
  setTimeout(() => {
    router.push(`/result/${sessionId.value}`)
  }, 800)
}
</script>

<style scoped>
.triage-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}

/* 进度条 */
.progress-bar { position: relative; height: 3px; background: var(--color-border); }
.progress-fill { height: 100%; background: var(--color-primary); transition: width 0.3s ease; }
.progress-text {
  position: absolute; right: var(--spacing-md); top: 6px;
  font-size: var(--font-size-xs); color: var(--color-text-hint);
}

/* 对话区域 */
.chat-area {
  flex: 1; overflow-y: auto; padding: var(--spacing-md);
  -webkit-overflow-scrolling: touch;
}

/* 快速症状 */
.quick-symptoms { margin-bottom: var(--spacing-md); }
.symptom-groups { margin-top: var(--spacing-md); }
.symptom-group { margin-bottom: var(--spacing-md); }
.group-label {
  font-size: var(--font-size-xs); color: var(--color-text-hint);
  margin-bottom: var(--spacing-xs); font-weight: 500;
}
.group-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.symptom-chip {
  display: inline-block;
  padding: 6px 14px;
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: 20px;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}
.symptom-chip:active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

/* 消息气泡 */
.chat-bubble { margin-bottom: var(--spacing-md); }
.bubble-content { display: flex; align-items: flex-start; max-width: 85%; }
.user-content { justify-content: flex-end; margin-left: auto; }

.bot-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--color-primary-light);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0; margin-right: var(--spacing-sm);
}

.bot-text {
  background: var(--color-white);
  border-radius: 0 var(--radius-md) var(--radius-md) var(--radius-md);
  padding: var(--spacing-md);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.bot-text p { font-size: var(--font-size-md); line-height: 1.6; color: var(--color-text); }

.user-text {
  background: var(--color-primary); color: white;
  border-radius: var(--radius-md) 0 var(--radius-md) var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-md); line-height: 1.6;
}

/* 选项 */
.options { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); margin-top: var(--spacing-sm); }
.option-btn {
  background: var(--color-primary-light); color: var(--color-primary);
  border: 1px solid var(--color-primary); border-radius: 20px;
  padding: 6px 16px; font-size: var(--font-size-md);
  cursor: pointer; transition: all 0.15s ease;
}
.option-btn:active { background: var(--color-primary); color: white; }

/* 打字动画 */
.typing-dots { display: flex; gap: 4px; padding: 4px 0; }
.typing-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-text-hint); animation: dot-bounce 1.2s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}

/* 输入区域 */
.input-area {
  background: var(--color-white);
  border-top: 1px solid var(--color-border);
  padding: var(--spacing-sm) var(--spacing-md);
  padding-bottom: calc(var(--spacing-sm) + env(safe-area-inset-bottom));
}
.input-row { display: flex; align-items: flex-end; gap: var(--spacing-sm); }
.input-row .van-field {
  flex: 1; background: var(--color-bg); border-radius: 20px; padding: 4px 12px;
}
.input-row .van-field :deep(.van-field__control) { max-height: 80px; }
.input-actions { display: flex; gap: var(--spacing-md); padding-top: var(--spacing-sm); }
.upload-btn {
  display: flex; align-items: center; gap: 4px;
  font-size: var(--font-size-xs); color: var(--color-text-hint); cursor: pointer;
}
</style>
