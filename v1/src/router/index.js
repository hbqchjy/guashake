import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/HomePage.vue'),
  },
  {
    path: '/triage',
    name: 'Triage',
    component: () => import('../views/TriagePage.vue'),
  },
  {
    path: '/result/:sessionId',
    name: 'Result',
    component: () => import('../views/ResultPage.vue'),
    props: true,
  },
  {
    path: '/hospital',
    name: 'Hospital',
    component: () => import('../views/HospitalPage.vue'),
  },
  {
    path: '/report',
    name: 'Report',
    component: () => import('../views/ReportPage.vue'),
  },
  {
    path: '/records',
    name: 'Records',
    component: () => import('../views/RecordsPage.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginPage.vue'),
  },
]

const router = createRouter({
  history: createWebHistory('/v1/'),
  routes,
})

export default router
