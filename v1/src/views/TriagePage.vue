<template>
  <div class="page triage-page">
    <van-nav-bar title="我不舒服" left-arrow @click-left="$router.push('/')" />

    <div class="followup-banner" v-if="showFollowupBanner">
      <div class="followup-head">
        <span class="followup-title">精准分析中</span>
        <span class="followup-step">第 {{ step }} / {{ totalSteps }} 题</span>
      </div>
      <div class="followup-sub">再回答几个选择题，我会把分析结果收得更准。</div>
      <div class="followup-track">
        <div class="followup-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
    </div>

    <div class="chat-area" ref="chatArea">
      <div class="quick-symptoms" v-if="stage === 'init'">
        <div class="chat-bubble bot">
          <div class="bubble-content">
            <div class="bot-avatar bot-avatar-brand">
              <img :src="brandIcon" alt="小科" />
            </div>
            <div class="bot-text intro-text">
              <p>告诉我你哪里不舒服，或者直接点一个常见症状开始。</p>
              <p>我会先判断大概方向和轻重，再告诉你现在该怎么办。</p>
            </div>
          </div>
        </div>

        <div class="quick-grid">
          <button
            v-for="item in primarySymptoms"
            :key="item.text"
            class="quick-chip"
            :class="{ 'quick-chip-risk': item.risk }"
            type="button"
            @click="quickStart(item.text)"
          >
            <span v-if="item.risk" class="quick-risk-icon">⚠</span>
            <span>{{ item.text }}</span>
          </button>
          <button
            class="quick-chip quick-chip-more"
            :class="{ active: showMoreSymptoms }"
            type="button"
            @click="showMoreSymptoms = !showMoreSymptoms"
          >
            <span class="quick-risk-icon">＋</span>
            <span>更多症状</span>
          </button>
        </div>

        <div class="more-symptoms" v-if="showMoreSymptoms">
          <div class="more-group" v-for="group in symptomGroups" :key="group.label">
            <div class="more-group-title">{{ group.label }}</div>
            <div class="more-group-row">
              <button
                v-for="item in group.items"
                :key="item.text"
                class="quick-chip more-chip"
                :class="{ 'quick-chip-risk': item.risk }"
                type="button"
                @click="quickStart(item.text)"
              >
                <span v-if="item.risk" class="quick-risk-icon">⚠</span>
                <span>{{ item.text }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        class="chat-bubble"
        v-for="(msg, i) in messages"
        :key="i"
        :class="msg.role"
      >
        <div class="bubble-content" v-if="msg.role === 'bot'">
          <div class="bot-avatar bot-avatar-brand">
            <img :src="brandIcon" alt="小科" />
          </div>
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

      <div class="chat-bubble bot" v-if="loading">
        <div class="bubble-content">
          <div class="bot-avatar bot-avatar-brand">
            <img :src="brandIcon" alt="小科" />
          </div>
          <div class="bot-text">
            <div class="typing-dots"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="composer-wrap" v-if="showInput">
      <div class="plus-menu" v-if="showPlusMenu">
        <button class="plus-item" type="button" @click="selectMenuAction('report')">
          <span class="plus-icon report"><van-icon name="description" size="20" /></span>
          <span>检查报告</span>
        </button>
        <button class="plus-item" type="button" @click="selectMenuAction('camera')">
          <span class="plus-icon camera"><van-icon name="photograph" size="20" /></span>
          <span>拍照</span>
        </button>
        <button class="plus-item" type="button" @click="selectMenuAction('image')">
          <span class="plus-icon image"><van-icon name="photo-o" size="20" /></span>
          <span>相册</span>
        </button>
        <button class="plus-item" type="button" @click="selectMenuAction('records')">
          <span class="plus-icon records"><van-icon name="notes-o" size="20" /></span>
          <span>历史记录</span>
        </button>
      </div>

      <div class="composer">
        <button class="icon-btn" type="button" @click="toggleComposerMode" :aria-label="composerMode === 'text' ? '切换语音' : '切换键盘'">
          <van-icon v-if="composerMode === 'text'" name="volume-o" size="20" />
          <svg v-else viewBox="0 0 24 24" class="keyboard-icon" aria-hidden="true">
            <rect x="2.5" y="5.5" width="19" height="13" rx="3"></rect>
            <path d="M6 10.2h.01M9 10.2h.01M12 10.2h.01M15 10.2h.01M18 10.2h.01"></path>
            <path d="M6 13.8h.01M9 13.8h.01M12 13.8h5.8"></path>
          </svg>
        </button>

        <div class="input-slot">
          <van-field
            v-if="composerMode === 'text'"
            v-model="inputText"
            :placeholder="inputPlaceholder"
            type="textarea"
            rows="1"
            autosize
            @keydown.enter.exact.prevent="sendText"
          />
          <button
            v-else
            class="voice-capture"
            type="button"
            :class="{ active: speechListening }"
            @touchstart.prevent="startVoiceCapture"
            @touchend.prevent="stopVoiceCapture"
            @touchcancel.prevent="stopVoiceCapture"
            @mousedown.prevent="startVoiceCapture"
            @mouseup.prevent="stopVoiceCapture"
            @mouseleave.prevent="stopVoiceCapture"
            @contextmenu.prevent
          >
            {{ voiceButtonText }}
          </button>
        </div>

        <button
          v-if="!hasTypedText"
          class="icon-btn plus-btn"
          type="button"
          aria-label="更多功能"
          @click="showPlusMenu = !showPlusMenu"
        >
          <van-icon name="plus" size="20" />
        </button>

        <button
          v-else
          class="send-btn"
          type="button"
          :disabled="loading"
          aria-label="发送"
          @click="sendText"
        >
          <van-icon name="arrow" size="18" />
        </button>
      </div>
    </div>

    <input ref="reportInput" type="file" accept="image/*,.pdf" hidden @change="pickFile($event, '检查报告')" />
    <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="pickFile($event, '拍照图片')" />
    <input ref="imageInput" type="file" accept="image/*" hidden @change="pickFile($event, '相册图片')" />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { showToast } from 'vant'
import {
  createTriageSession,
  answerTriageQuestion,
  sendTriageMessage,
  sendTriageSupplement,
  uploadTriageFile,
  startTriageWithFile,
  getTriageState,
} from '../api'

const router = useRouter()
const route = useRoute()
const chatArea = ref(null)
const reportInput = ref(null)
const cameraInput = ref(null)
const imageInput = ref(null)
const brandIcon = `${import.meta.env.BASE_URL}icon.svg`

const sessionId = ref('')
const messages = ref([])
const inputText = ref('')
const loading = ref(false)
const step = ref(0)
const totalSteps = ref(0)
const stage = ref('init')
const showInput = ref(true)
const currentQuestionId = ref('')
const showPlusMenu = ref(false)
const showMoreSymptoms = ref(false)
const composerMode = ref('text')
const speechListening = ref(false)
const mediaRecorder = ref(null)
const mediaChunks = ref([])
const hasShownStructuredIntro = ref(false)

const primarySymptoms = [
  { text: '胃不舒服' },
  { text: '咳嗽有痰' },
  { text: '头晕头痛' },
  { text: '胸口发闷' },
  { text: '腰酸腰痛' },
  { text: '尿频尿痛' },
  { text: '皮肤起疹' },
  { text: '拉肚子' },
  { text: '便秘拉不出' },
  { text: '眼睛不舒服' },
  { text: '心慌气短' },
  { text: '喉咙痛' },
  { text: '黑便', risk: true },
  { text: '便血', risk: true },
  { text: '呕血', risk: true },
]

const symptomGroups = [
  {
    label: '常见不舒服',
    items: [
      { text: '恶心想吐' }, { text: '肚子痛' }, { text: '反酸烧心' }, { text: '发热怕冷' }, { text: '鼻塞流涕' },
    ],
  },
  {
    label: '疼痛和外伤',
    items: [
      { text: '关节疼' }, { text: '颈肩痛' }, { text: '摔伤扭伤' }, { text: '牙痛脸肿' }, { text: '耳朵痛' },
    ],
  },
  {
    label: '妇儿和其他',
    items: [
      { text: '月经不正常' }, { text: '孩子发烧' }, { text: '失眠焦虑' }, { text: '肛门不舒服' }, { text: '检查报告解读' },
    ],
  },
]

const inputPlaceholder = computed(() => {
  if (stage.value === 'init') return '直接描述哪里不舒服'
  if (stage.value === 'open') return '继续描述你的情况'
  if (stage.value === 'supplement') return '补充新的变化、病史或检查情况'
  return '补充上面没提到的信息'
})

const progressPercent = computed(() => {
  if (totalSteps.value <= 0) return 0
  return Math.min((step.value / totalSteps.value) * 100, 100)
})

const showFollowupBanner = computed(() => {
  return (stage.value === 'structured' || stage.value === 'supplement') && step.value > 0 && totalSteps.value > 0
})

const hasTypedText = computed(() => composerMode.value === 'text' && !!inputText.value.trim())

const voiceButtonText = computed(() => {
  if (loading.value) return '识别中...'
  return speechListening.value ? '松开发送' : '按住说话'
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

function quickStart(symptom) {
  stage.value = 'starting'
  showMoreSymptoms.value = false
  addUserMessage(symptom)
  startSession(symptom)
}

function toggleComposerMode() {
  showPlusMenu.value = false
  composerMode.value = composerMode.value === 'text' ? 'voice' : 'text'
  if (composerMode.value === 'voice') {
    inputText.value = ''
  }
}

async function sendText() {
  const text = inputText.value.trim()
  if (!text || loading.value) return
  inputText.value = ''
  showPlusMenu.value = false
  showMoreSymptoms.value = false
  addUserMessage(text)

  if (stage.value === 'init') {
    stage.value = 'starting'
    await startSession(text)
  } else if (stage.value === 'open') {
    await continueOpen(text)
  } else if (stage.value === 'structured' || stage.value === 'supplement') {
    await supplement(text)
  }
}

async function startSession(complaint) {
  loading.value = true
  try {
    const res = await createTriageSession({ chiefComplaint: complaint })
    sessionId.value = res.sessionId
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

    if (res.nextPrompt?.type === 'text') {
      stage.value = 'open'
      addBotMessage(res.nextPrompt.text || res.assistantReply)
      return
    }

    if (res.nextQuestion) {
      stage.value = 'structured'
      announceStructuredMode(res.assistantReply)
      showQuestion(res)
      return
    }

    if (res.assistantReply) {
      stage.value = 'open'
      addBotMessage(res.assistantReply)
    }
  } catch {
    addBotMessage('抱歉，系统出了点问题，请稍后再试。')
    stage.value = 'init'
  } finally {
    loading.value = false
  }
}

async function continueOpen(text) {
  loading.value = true
  try {
    const res = await sendTriageMessage({
      sessionId: sessionId.value,
      message: text,
    })

    if (res.needsConfirmation) {
      stage.value = 'supplement'
      if (res.assistantReply) addBotMessage(res.assistantReply)
      addBotMessage('信息差不多了，要不要现在生成分析结果？', [
        { label: '生成结果', value: '__generate__' },
        { label: '我还想补充', value: '__continue__' },
      ])
      return
    }

    if (res.mode === 'immediate_result') {
      if (res.assistantReply) addBotMessage(res.assistantReply)
      goResult()
      return
    }

    if (res.mode === 'question' && res.nextQuestion) {
      stage.value = 'structured'
      announceStructuredMode(res.assistantReply)
      showQuestion(res)
      return
    }

    if (res.nextPrompt?.type === 'text') {
      stage.value = 'open'
      addBotMessage(res.nextPrompt.text || res.assistantReply)
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

function showQuestion(res) {
  const q = res.nextQuestion
  if (!q) return
  currentQuestionId.value = q.id || ''
  step.value = res.progress?.current || step.value + 1
  totalSteps.value = res.progress?.total || totalSteps.value
  const options = (q.options || []).map(opt =>
    typeof opt === 'string' ? { label: opt, value: opt } : opt,
  )
  addBotMessage(q.text || q.question, options)
}

async function selectOption(opt) {
  const label = opt.label || opt
  const value = opt.value || opt
  addUserMessage(label)

  if (value === '__generate__') {
    goResult()
    return
  }
  if (value === '__continue__') {
    stage.value = 'supplement'
    addBotMessage('好的，你继续补充新的情况、变化、病史或检查结果，我会据此更新分析。')
    return
  }

  loading.value = true

  try {
    const res = await answerTriageQuestion({
      sessionId: sessionId.value,
      answer: value,
      questionId: currentQuestionId.value,
    })

    if (res.complete || res.done || res.followUp?.completed) {
      if (res.needsConfirmation) {
        stage.value = 'supplement'
        addBotMessage('信息差不多了，要不要现在生成分析结果？', [
          { label: '生成结果', value: '__generate__' },
          { label: '我还想补充', value: '__continue__' },
        ])
      } else {
        goResult()
      }
      return
    }

    if (res.needsConfirmation) {
      stage.value = 'supplement'
      addBotMessage('信息差不多了，要不要现在生成分析结果？', [
        { label: '生成结果', value: '__generate__' },
        { label: '我还想补充', value: '__continue__' },
      ])
      return
    }

    if (res.nextQuestion) {
      showQuestion(res)
    } else if (res.assistantReply) {
      addBotMessage(res.assistantReply)
    }
  } catch {
    addBotMessage('抱歉，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function supplement(text) {
  loading.value = true
  try {
    const res = await sendTriageSupplement({
      sessionId: sessionId.value,
      supplement: text,
    })
    if (res.forceImmediateResult) {
      if (res.reply) addBotMessage(res.reply)
      goResult()
      return
    }
    if (res.nextQuestion) {
      stage.value = 'structured'
      announceStructuredMode(res.reply || res.assistantReply)
      showQuestion(res)
    } else if (res.refreshSummary || res.affectsSummary) {
      stage.value = 'supplement'
      addBotMessage(
        res.reply || '根据你刚补充的新信息，当前分析可能会变化。要不要现在更新分析结果？',
        [
          { label: '更新分析', value: '__generate__' },
          { label: '继续补充', value: '__continue__' },
        ],
      )
    } else if (res.reply) {
      addBotMessage(res.reply)
    } else if (res.assistantReply) {
      addBotMessage(res.assistantReply)
    } else {
      stage.value = 'supplement'
      addBotMessage('这条补充我已经记下了。你可以继续补充，或者直接更新分析。', [
        { label: '更新分析', value: '__generate__' },
        { label: '继续补充', value: '__continue__' },
      ])
    }
  } catch {
    addBotMessage('抱歉，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function selectMenuAction(action) {
  showPlusMenu.value = false
  if (action === 'records') {
    router.push('/records')
    return
  }
  if (action === 'report') {
    reportInput.value?.click()
    return
  }
  if (action === 'camera') {
    cameraInput.value?.click()
    return
  }
  imageInput.value?.click()
}

async function pickFile(event, label) {
  const file = event.target.files?.[0]
  if (!file) return

  addUserMessage(`[上传${label}] ${file.name}`)
  loading.value = true

  try {
    if (!sessionId.value) {
      const res = await startTriageWithFile(file, label)
      sessionId.value = res.sessionId
      stage.value = res.conversationStage || 'structured'
      localStorage.setItem('currentSessionId', res.sessionId)
      localStorage.setItem('currentComplaint', res.chiefComplaint || label)

      if (res.assistantReply) addBotMessage(res.assistantReply)

      if (res.immediateResult) {
        goResult()
      } else if (res.nextPrompt?.type === 'text') {
        stage.value = 'open'
        addBotMessage(res.nextPrompt.text)
      } else if (res.nextQuestion) {
        stage.value = 'structured'
        announceStructuredMode()
        showQuestion(res)
      }
    } else {
      const res = await uploadTriageFile(sessionId.value, file)
      const summary = res.file?.summary
      if (res.forceImmediateResult) {
        if (res.reply) addBotMessage(res.reply)
        goResult()
      } else if (summary?.highlights?.length) {
        addBotMessage(`我先记下这份材料：${summary.highlights.slice(0, 3).join('、')}。`)
      } else {
        addBotMessage('图片已上传，我会把这份材料一起纳入分析。')
      }
    }
  } catch {
    addBotMessage('图片上传失败，请重试。')
  } finally {
    loading.value = false
    event.target.value = ''
  }
}

async function startVoiceCapture() {
  if (loading.value || speechListening.value) return
  const recorderClass = window.MediaRecorder
  if (!recorderClass || !navigator.mediaDevices?.getUserMedia) {
    showToast('当前设备暂不支持语音输入')
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaChunks.value = []
    const mimeType = recorderClass.isTypeSupported?.('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : ''
    const recorder = new recorderClass(stream, mimeType ? { mimeType } : undefined)
    mediaRecorder.value = recorder
    speechListening.value = true
    playCue('start')

    recorder.ondataavailable = (evt) => {
      if (evt.data?.size) mediaChunks.value.push(evt.data)
    }
    recorder.onstop = async () => {
      speechListening.value = false
      const blob = new Blob(mediaChunks.value, { type: recorder.mimeType || 'audio/webm' })
      stream.getTracks().forEach(track => track.stop())
      if (!blob.size) return
      await transcribeAudio(blob)
    }
    recorder.start()
  } catch {
    showToast('无法访问麦克风，请检查权限设置')
  }
}

function stopVoiceCapture() {
  if (!speechListening.value) return
  playCue('stop')
  try {
    mediaRecorder.value?.stop()
  } catch {
    speechListening.value = false
  }
}

async function transcribeAudio(blob) {
  loading.value = true
  try {
    const form = new FormData()
    form.append('audio', blob, 'voice.webm')
    const response = await fetch('/api/asr', { method: 'POST', body: form })
    const data = await response.json()
    if (!data.ok || !data.text?.trim()) {
      showToast('这次没有识别到语音内容')
      return
    }
    const transcript = data.text.trim()
    inputText.value = ''
    loading.value = false
    addUserMessage(transcript)
    if (stage.value === 'init') {
      stage.value = 'starting'
      await startSession(transcript)
    } else if (stage.value === 'open') {
      await continueOpen(transcript)
    } else if (stage.value === 'structured' || stage.value === 'supplement') {
      await supplement(transcript)
    }
    return
  } catch {
    showToast('语音识别失败，请重试')
  } finally {
    loading.value = false
  }
}

function announceStructuredMode(message = '') {
  if (!hasShownStructuredIntro.value) {
    addBotMessage(message || '为了更准确地帮你分析，我再确认几个选择题。')
    hasShownStructuredIntro.value = true
    return
  }
  if (message) addBotMessage(message)
}

async function restoreSession() {
  const resumeId = String(route.query.sessionId || '').trim()
  const resumeMode = String(route.query.mode || '').trim()
  if (!resumeId) return
  loading.value = true
  try {
    const state = await getTriageState(resumeId)
    sessionId.value = resumeId
    localStorage.setItem('currentSessionId', resumeId)
    step.value = state.progress?.current || 0
    totalSteps.value = state.progress?.total || 0

    if (resumeMode === 'supplement' || state.hasResult) {
      stage.value = 'supplement'
      addBotMessage('继续补充新的情况、检查结果或身体变化，我会根据新信息更新分析。')
      return
    }

    if (state.currentQuestion) {
      stage.value = 'structured'
      hasShownStructuredIntro.value = true
      showQuestion({
        nextQuestion: state.currentQuestion,
        progress: state.progress,
      })
      return
    }

    if (state.currentPrompt?.text) {
      stage.value = 'open'
      addBotMessage(state.currentPrompt.text)
      return
    }

    stage.value = 'open'
    addBotMessage('继续说说你这次最不舒服的地方，我会接着往下分析。')
  } catch {
    showToast('恢复当前咨询失败')
  } finally {
    loading.value = false
  }
}

function playCue(type = 'start') {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = type === 'start' ? 740 : 520
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.12)
    oscillator.onended = () => ctx.close().catch(() => {})
  } catch {
    // ignore
  }
}

function goResult() {
  stage.value = 'done'
  showInput.value = false
  showPlusMenu.value = false
  addBotMessage('分析完成，正在生成结果...')
  localStorage.setItem('currentSessionId', sessionId.value)
  setTimeout(() => {
    router.push(`/result/${sessionId.value}`)
  }, 800)
}

function handleDocumentClick(event) {
  if (!(event.target instanceof Element) || !event.target.closest('.composer-wrap')) {
    showPlusMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  restoreSession()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<style scoped>
.triage-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}

.followup-banner {
  margin: 10px var(--spacing-md) 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f5fcf8 0%, #edf9f2 100%);
  border: 1px solid rgba(0, 181, 120, 0.14);
}
.followup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.followup-title {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-primary-deep);
}
.followup-step {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-primary);
}
.followup-sub {
  margin-top: 4px;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.followup-track {
  margin-top: 10px;
  height: 6px;
  border-radius: 999px;
  background: rgba(0, 181, 120, 0.12);
  overflow: hidden;
}
.followup-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-deep));
  transition: width 0.3s ease;
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  -webkit-overflow-scrolling: touch;
}

.quick-symptoms {
  margin-bottom: var(--spacing-md);
}

.intro-text p + p {
  margin-top: 6px;
  color: var(--color-text-secondary);
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-top: var(--spacing-md);
}

.quick-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--color-border);
  background: linear-gradient(180deg, #ffffff 0%, #f8faf9 100%);
  border-radius: 999px;
  min-height: 42px;
  padding: 0 10px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #374047;
  box-shadow: 0 6px 16px rgba(18, 28, 24, 0.04);
}
.quick-chip:active {
  background: var(--color-primary-light);
  border-color: rgba(0, 181, 120, 0.3);
}

.quick-chip-risk {
  border-color: rgba(224, 86, 33, 0.3);
  background: linear-gradient(180deg, #fff8f5 0%, #fff5ef 100%);
  color: #7a2f11;
}

.quick-risk-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 12px;
  line-height: 1;
}

.quick-chip-more {
  border-style: dashed;
  color: #2f6e52;
  background: linear-gradient(180deg, #f8fffb 0%, #f1faf5 100%);
}

.quick-chip-more.active {
  border-color: rgba(7, 193, 96, 0.45);
  background: linear-gradient(180deg, #eefdf5 0%, #e8f9f1 100%);
}

.more-symptoms {
  margin-top: 12px;
  padding: 12px;
  background: #ffffff;
  border-radius: 16px;
}

.more-group + .more-group {
  margin-top: 12px;
}

.more-group-title {
  margin-bottom: 8px;
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-text);
}

.more-group-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.more-chip {
  min-height: 40px;
}

.chat-bubble {
  margin-bottom: var(--spacing-md);
}
.bubble-content {
  display: flex;
  align-items: flex-start;
  max-width: 94%;
}
.user-content {
  justify-content: flex-end;
  margin-left: auto;
}

.bot-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
  margin-right: var(--spacing-sm);
}

.bot-avatar-brand {
  background: transparent;
}
.bot-avatar-brand img {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: block;
}

.bot-text {
  background: var(--color-white);
  border-radius: 0 var(--radius-md) var(--radius-md) var(--radius-md);
  padding: 12px 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  width: min(100%, 680px);
}
.bot-text p {
  font-size: var(--font-size-md);
  line-height: 1.6;
  color: var(--color-text);
}

.user-text {
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md) 0 var(--radius-md) var(--radius-md);
  padding: 10px 14px;
  font-size: var(--font-size-md);
  line-height: 1.6;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}
.option-btn {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border: 1px solid rgba(0, 181, 120, 0.3);
  border-radius: 18px;
  padding: 8px 14px;
  font-size: var(--font-size-md);
}

.typing-dots {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}
.typing-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-hint);
  animation: dot-bounce 1.2s infinite;
}
.typing-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.typing-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}

.composer-wrap {
  position: relative;
  background: var(--color-white);
  border-top: 1px solid var(--color-border);
  padding: 12px 14px calc(18px + env(safe-area-inset-bottom));
  box-shadow: 0 -6px 18px rgba(16, 24, 40, 0.04);
}

.plus-menu {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 4px 4px 12px;
}

.plus-item {
  background: transparent;
  border: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.plus-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}
.plus-icon.report { background: #2d8cf0; }
.plus-icon.camera { background: #ff9f43; }
.plus-icon.image { background: #5f6dfc; }
.plus-icon.records { background: var(--color-primary); }

.composer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-btn,
.send-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: #4a4a4a;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.plus-btn {
  background: #f2f3f5;
}

.send-btn {
  background: var(--color-primary);
  color: white;
}
.send-btn:disabled {
  opacity: 0.5;
}

.input-slot {
  flex: 1;
  min-width: 0;
}

.input-slot :deep(.van-field) {
  background: #f2f3f5;
  border-radius: 22px;
  min-height: 46px;
  padding: 10px 16px;
}

.input-slot :deep(.van-field__control) {
  max-height: 88px;
  line-height: 22px;
}

.voice-capture {
  width: 100%;
  height: 46px;
  border-radius: 22px;
  border: 0;
  background: #f2f3f5;
  color: var(--color-text);
  font-size: var(--font-size-md);
}
.voice-capture.active {
  background: #e7f7ef;
  color: var(--color-primary);
}

.keyboard-icon {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  stroke-width: 1.8;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 420px) {
  .quick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .bubble-content {
    max-width: 96%;
  }
}
</style>
