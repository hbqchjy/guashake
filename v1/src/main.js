import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import 'vant/es/notify/style'
import './styles/global.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
