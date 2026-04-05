<template>
  <div class="page">
    <van-nav-bar title="登录" left-arrow @click-left="$router.back()" />

    <div class="login-content">
      <div class="login-logo">
        <span class="logo-icon">&#x1F3E5;</span>
        <h2>挂啥科</h2>
        <p>登录后可保存就诊记录</p>
      </div>

      <van-form @submit="onSubmit" class="login-form">
        <van-cell-group inset>
          <van-field
            v-model="phone"
            label="手机号"
            type="tel"
            placeholder="请输入手机号"
            maxlength="11"
            :rules="[{ required: true, message: '请输入手机号' }]"
          />
          <van-field
            v-model="password"
            label="密码"
            type="password"
            placeholder="请输入密码（4位以上）"
            :rules="[{ required: true, message: '请输入密码' }]"
          />
        </van-cell-group>

        <div class="form-actions">
          <van-button block round type="primary" native-type="submit" :loading="loading">
            登录 / 注册
          </van-button>
        </div>
      </van-form>

      <p class="login-hint">首次登录将自动注册</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { loginByPassword } from '../api'

const router = useRouter()
const phone = ref('')
const password = ref('')
const loading = ref(false)

async function onSubmit() {
  loading.value = true
  try {
    const res = await loginByPassword(phone.value, password.value)
    const auth = res.auth || res
    if (auth.loggedIn || res.ok) {
      localStorage.setItem('userId', auth.userId)
      localStorage.setItem('nickname', auth.nickname || '')
      localStorage.setItem('phone', auth.phone || '')
      showToast('登录成功')
      router.push('/')
    } else {
      showToast(res.error || '登录失败')
    }
  } catch (e) {
    showToast('网络错误，请重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-content {
  padding: var(--spacing-xl) var(--spacing-md);
}
.login-logo {
  text-align: center;
  padding: var(--spacing-xl) 0;
}
.logo-icon {
  font-size: 48px;
  display: block;
  margin-bottom: var(--spacing-sm);
}
.login-logo h2 {
  font-size: var(--font-size-xxl);
  color: var(--color-primary);
  font-weight: 700;
}
.login-logo p {
  font-size: var(--font-size-sm);
  color: var(--color-text-hint);
  margin-top: 4px;
}
.login-form {
  margin-top: var(--spacing-lg);
}
.form-actions {
  padding: var(--spacing-lg) var(--spacing-md) 0;
}
.login-hint {
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-hint);
  margin-top: var(--spacing-md);
}
</style>
