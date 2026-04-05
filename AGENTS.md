# 挂啥科 (GuaShaKe) - AI 开发指南

> 本项目完全由 AI 工具 (Claude Code / Codex) 开发维护，无人工程师。修改前务必读完本文件。

## 项目概述

医疗分诊助手，帮用户判断该挂什么科。三阶段产品：
1. **我不舒服** — 症状对话式分诊 → 推荐科室 + 严重程度 + 准备清单
2. **我在医院** — 拍检查单/处方 → AI 分析必要性和费用
3. **我看完了** — 拍检验报告 → AI 解读指标异常

线上地址：`https://gh.goldphysicalbitcoin.com/v1/`（新版 Vue）
老版地址：`https://gh.goldphysicalbitcoin.com/`（Node.js 直出，仅供对比）

## 目录结构

```
guahao/
├── src/                    # 后端 (Node.js + Express)
│   ├── server.js           # 主入口，所有 API 路由
│   ├── ai.js               # Dashscope (Qwen) 调用，分诊 + 分析
│   ├── store.js            # SQLite 数据层 (better-sqlite3, WAL 模式)
│   ├── rules.js            # 分诊规则引擎
│   ├── hospitals.js        # 医院数据
│   ├── regions.js          # 地区数据
│   ├── pdf.js              # PDF 生成
│   └── file-summary.js     # 文件摘要
├── public/                 # 老版前端 (vanilla JS，不再维护)
│   ├── index.html
│   ├── app.js              # 104KB 单文件，包含完整对话状态机
│   └── styles.css
├── v1/                     # 新版前端 (Vue3 + Vant4 + Vite)
│   ├── src/
│   │   ├── App.vue
│   │   ├── router/index.js # 路由，base: '/v1/'
│   │   ├── api/index.js    # 所有 API 调用封装
│   │   ├── views/          # 7 个页面
│   │   ├── components/     # DisclaimerPopup
│   │   ├── composables/    # useDisclaimer
│   │   └── styles/         # variables.css + global.css
│   ├── vite.config.js      # base: '/v1/', Vant auto-import
│   ├── dist/               # 构建产物，nginx 直接 serve
│   └── package.json
├── deploy/
│   ├── guashake-nginx.conf # 生产 nginx 配置（实际使用的）
│   ├── nginx.conf          # 模板，未使用
│   ├── deploy.sh           # 一键部署: pull → build → restart
│   ├── backup.sh           # 每日 SQLite 备份 (crontab)
│   └── monitor.sh          # 5 分钟健康检查 (crontab)
├── data/
│   └── guashake.db         # SQLite 数据库文件
└── uploads/                # 用户上传图片
```

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Express (Node.js) | 端口 3000，PM2 管理 (进程名 `guashake`) |
| 数据库 | SQLite (better-sqlite3) | WAL 模式，6 张表 |
| AI/LLM | 阿里云 Dashscope (Qwen) | **不是 Claude API**，不是 OpenAI |
| 新前端 | Vue3 + Vant4 + Vite | 路径 `/v1/`，白色简洁风格 |
| 老前端 | 原生 JS | 路径 `/`，仅保留对比，不再维护 |
| 反代 | Nginx | 只监听 80 端口，SSL 由 xray 处理 |
| HTTPS | xray 处理 SSL 终结 | **nginx 不能加 `listen 443 ssl`** |
| 进程 | PM2 | `pm2 restart guashake` |
| CDN | Cloudflare | 前面有 Cloudflare 代理 |

## 关键架构约定

### 分诊对话状态机（最重要）

后端分诊有多阶段对话，前端必须匹配：

```
triage/session (POST) → 创建会话
  ↓
conversationStage: 'open' → triage/message (POST) 自由对话
  ↓
conversationStage: 'structured' → triage/answer (POST) 选择题
  ↓
conversationStage: 'done' / immediateResult → triage/result/:id (GET)
```

- `triage/message` 发送 `{ sessionId, text }`
- `triage/answer` 发送 `{ sessionId, answer }`
- `triage/supplement` 发送 `{ sessionId, supplement }` ← 注意字段名是 `supplement` 不是 `text`

### 三阶段数据贯通

ResultPage → 点击"我去医院了" → 将分诊上下文存入 `localStorage.triageContext`
HospitalPage / ReportPage → 读取 `triageContext` → 显示横幅 + 传给 AI 分析 API

### 五级严重度

| 级别 | 颜色 | 含义 |
|---|---|---|
| observe | #00B578 绿 | 可观察等待 |
| self_treat | #1890FF 蓝 | 建议自行处理 |
| visit_soon | #FAAD14 黄 | 建议近期就诊 |
| visit_today | #FF4D4F 红 | 建议尽快就诊 |
| emergency | #333333 黑 | 建议立即急诊 |

### SQLite 表结构

`sessions` / `users` / `archives` / `auth_requests` / `auth_tickets` / `analytics`

- `users.phone` 有条件唯一索引: `WHERE phone != ''`（空手机号允许多个）
- `store.js` 导出的函数签名与老版 JSON 存储完全一致，server.js 零改动

### Nginx 注意事项

- **绝对不能加 `listen 443 ssl`**，端口被 xray 占用，加了 nginx reload 会失败
- `/v1/` 用 `alias` 指向 `v1/dist/`，`/` 用 `proxy_pass` 到 Node.js 3000
- 构建后需要修复权限：`chmod -R o+r v1/dist && find v1/dist -type d -exec chmod o+x {} +`

### 前端构建和部署

```bash
cd /home/hulinbit/guahao/v1
npx vite build
chmod -R o+r dist && find dist -type d -exec chmod o+x {} +
# 或者用一键脚本:
bash deploy/deploy.sh
```

## 已知待办（TODO）

以下是需要后续完成的功能和优化，按优先级排列：

### 高优先级
1. **API 频率限制** — 后端没有 rate limiting，上线后会被刷。建议用 `express-rate-limit`，分诊接口 10次/分钟，分析接口 5次/分钟
2. **数据清理** — sessions 表无限增长。建议加 cron 任务，清理 90 天前已完成的会话
3. **认证加固** — 当前 localStorage 存 userId 无过期机制。建议加 JWT token + 7 天过期

### 中优先级
4. **错误监控** — 后端错误只打 console.log，没有告警。可接 Server酱 推送
5. **分诊结果持久化** — 当前结果页依赖 API 实时返回，刷新可能丢失。可以存到 archives 表
6. **图片压缩** — 用户上传的手机照片可能很大，建议前端压缩到 1MB 以内再上传

### 低优先级
7. **PWA 支持** — 添加 manifest + service worker，可添加到手机主屏幕
8. **多语言** — 目前只有中文
9. **深色模式** — variables.css 已经用 CSS 变量，切换比较方便

## UI 风格要求

- 简洁白底，不要花哨的渐变和阴影
- 使用 Vant4 组件库，不要自造轮子
- 字体用系统默认，不引入额外字体
- 商用级质感，**不能有 demo 感**
- CSS 变量定义在 `v1/src/styles/variables.css`

## 常见坑

1. `su -c "命令" root` 执行需要 root 权限的操作，sudo 密码不对
2. 前端 `base: '/v1/'` 和 `createWebHistory('/v1/')` 必须一致
3. Dashscope API key 在环境变量或 .env 中，不要硬编码
4. PM2 进程名是 `guashake`，重启用 `pm2 restart guashake`
5. `alias` + `try_files` 在 nginx 中有已知兼容问题，目前能工作就别动
