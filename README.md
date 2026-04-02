# 挂啥科 MVP

面向微信公众号 H5 的就医前信息辅助原型，目标是把普通用户最关心的问题先讲明白：
- 挂什么科
- 先做哪些最小必要检查
- 大概花多少钱
- 医保怎么更划算
- 去医院前要带什么

> 边界：仅做就医前信息参考，不替代医生面诊，不提供诊断结论和处方。

## 0. 中国大陆网络约束（长期前置）
本项目的真实用户主要在中国大陆，技术方案默认遵循以下约束：
- 默认假设用户无法稳定访问 Google 语音链路，不能依赖浏览器原生 `SpeechRecognition` 作为主语音方案。
- 涉及语音能力，优先采用中国大陆可用链路（例如录音上传 + 国内 ASR 服务）。
- 涉及微信 H5 能力（定位、登录、语音），必须先校验公众号能力、域名配置与合规限制，不可假设可直接启用。
- 任何新增技术方案，需先评估中国大陆网络可达性，再进入实现。

## 1. 总体技术方案
- 前端：H5 单页应用（`public/index.html + app.js + styles.css`）
- 后端：Node.js + Express（`src/server.js`）
- 规则引擎：症状场景库 + 追问题库 + 分层输出（`src/rules.js`）
- 模型层：阿里百炼文本路由 + OCR（`src/ai.js`）
- 存储：JSON 文件持久化（`data/db.json`，运行时自动创建）
- 文件：`multer` 本地上传到 `uploads/`
- 导出：`pdfkit` 生成档案 PDF

## 2. 技术栈建议（当前实现）
- Node.js 20+
- Express 4
- Multer
- PDFKit
- Vanilla JS + CSS（适老化大字大按钮）

适合快速迭代、AI 代理连续生成、海外 VPS 直接部署。

## 3. 系统架构（文字图）
- 用户（公众号 H5）
  -> `POST /triage/session` 创建预诊会话
  -> `POST /triage/answer` 连续追问
  -> `GET /triage/result/:id` 三层输出
  -> `POST /cost/estimate` 费用与医保参考
  -> `GET /booking/options` 挂号与准备清单
  -> `POST /archive/upload` 建档上传
  -> `GET /archive/list` 查看历史
  -> `GET /archive/export` 导出 PDF
- 后端服务
  -> 规则库（场景识别/追问/风险分流）
  -> JSON 存储（会话、档案）
  -> 文件存储（上传资料）

## 4. 数据结构（MVP）
当前以 JSON 存储，对应核心实体：
- `users`（简化为 userId 字段，后续可扩表）
- `sessions`：基础信息、主诉、追问答案、预诊结果
- `archives`：历史就诊记录、文件元数据、导出对象

后续建议关系型表（MySQL/Postgres）：
- `users`
- `consultations`
- `consultation_messages`
- `symptom_sessions`
- `cost_estimates`
- `hospitals`
- `insurance_rules`
- `medical_records`
- `uploaded_files`

## 5. API 设计（已实现）
- `GET /api/health`
- `POST /triage/session`
- `POST /triage/answer`
- `POST /triage/supplement`
- `POST /triage/supplement-file`
- `GET /triage/result/:id`
- `POST /cost/estimate`
- `GET /booking/options?sessionId=...`
- `POST /archive/upload`（multipart）
- `GET /archive/list?userId=...`
- `DELETE /archive/:userId/:recordId`
- `GET /archive/export?userId=...&recordId=...`

### 5.1 当前 AI 接入（2026-03-30）
- 文本模型：`qwen3.5-plus-2026-02-15`
- OCR 模型：`qwen-vl-ocr-latest`
- 当前策略：
  - 首轮主诉先走规则路由
  - 规则明显识别不出来时，再调用文本模型做场景补路由
  - V2 追问阶段改成“动态下一问”：
    - 模型根据当前上下文决定下一问最有价值的槽位
    - 并动态改写问题和选项
    - 模型失败时回退到默认顺序
  - 图片类报告上传时，优先调用 OCR 模型提取文字
  - 模型调用失败或超时，自动回退到现有规则/基础摘要

## 6. 页面结构（已实现）
- 首页/信息采集页（地区、医保、主诉）
- 追问页（单题单屏，选择题优先）
- 预诊结果页（三层输出：核心结论/展开说明/风险提醒）
- 费用页（简版 + if/then 分步路径）
- 辅助挂号页（医院级别、科室、号别、准备清单）
- 健康档案页（上传、列表、删除、PDF 导出）

## 7. 问诊状态机
- `INIT`
- `COLLECT_BASIC_INFO`
- `COLLECT_MAIN_SYMPTOM`
- `FOLLOW_UP_QUESTIONS`
- `GENERATE_PRE_TRIAGE`
- `GENERATE_COST_ESTIMATE`
- `SHOW_RESULT`
- `SAVE_RECORD`

停止追问条件：
- 达到追问上限（当前 4 轮）
- 用户主动跳过
- 命中急症红旗（输出紧急提示）

## 8. Prompt 设计（下一步接入 LLM 时使用）
### 症状理解 Prompt
- 输入：主诉文本 + 年龄性别 + 地区
- 输出：高频场景标签、风险词、需要追问的关键维度
- 约束：中文口语化，不给诊断结论

### 追问生成 Prompt
- 输入：场景标签 + 已有答案
- 输出：1 个最关键追问，必须是选择题，选项 2-5 个
- 约束：问题短句，避免医学术语堆砌

### 结果总结 Prompt
- 输出三层：核心结论、展开说明、风险提醒
- 用词：可能/建议/不能排除
- 必带：不能替代医生面诊

### 费用预估 Prompt
- 输出：首轮最小必要检查 + 区间费用 + if/then 追加策略
- 约束：先低成本后升级，不推荐一次性全做

### 就诊建议 Prompt
- 输出：医院级别、科室、号别、准备清单
- 约束：优先普通号，必要时再专家号

## 9. 首批覆盖场景（已实现 6 类）
- 心慌/胸闷/头晕/高血压相关
- 腰酸/腰痛/腿麻
- 肚子痛/胃不舒服/消化问题
- 尿频/尿急/尿痛
- 咳嗽/发热/呼吸道不适
- 外伤/皮肤问题

## 10. 开发计划（可迭代）
- Phase 1（已完成）：可运行原型 + 四模块闭环
- Phase 2：增强追问逻辑（条件分支、反问澄清、历史上下文）
- Phase 3：地区化医保/费用规则数据管道（月度更新 + 覆盖等级）
- Phase 4：接入 OCR 与 LLM，总结质量和档案结构化提升

## 10.1 OCR Webhook 契约（已预留）
当前后端已经支持 `OCR_WEBHOOK_URL` 环境变量。

如果配置了：
```bash
export OCR_WEBHOOK_URL="https://your-ocr-service.example.com/ocr"
```

后端会在上传补充材料时，向该地址发送 `multipart/form-data`：
- 字段名：`file`
- 内容：用户上传的原始文件

期望 OCR 服务返回 JSON，满足以下任一种字段即可：
```json
{ "text": "这里是识别出的文字" }
```
或
```json
{ "ocrText": "这里是识别出的文字" }
```
或
```json
{ "content": "这里是识别出的文字" }
```

当前如果未配置 OCR，系统会自动退回 `fallback` 模式，只根据文件名和材料类型生成基础摘要。

## 11. 运行方式
```bash
npm install
npm start
# 打开 http://localhost:3000
```

### 11.1 启用阿里百炼模型
当前服务支持以下环境变量：

```bash
export DASHSCOPE_API_KEY="你的阿里百炼 API Key"
export DASHSCOPE_TEXT_MODEL="qwen3.5-plus-2026-02-15"
export DASHSCOPE_OCR_MODEL="qwen-vl-ocr-latest"
export AI_RESULT_REWRITE="0"
```

说明：
- `DASHSCOPE_API_KEY`：必须配置，模型能力才会启用
- `DASHSCOPE_TEXT_MODEL`：默认就是 `qwen3.5-plus-2026-02-15`
- `DASHSCOPE_OCR_MODEL`：默认就是 `qwen-vl-ocr-latest`
- `AI_RESULT_REWRITE`：默认建议保持 `0`
  - `0`：结果总结继续走当前规则模板，不拖慢首屏
  - `1`：结果生成阶段再让模型润色，但当前实测会明显增加等待时间

如果是 PM2 运行，可直接：

```bash
DASHSCOPE_API_KEY="你的阿里百炼 API Key" \
DASHSCOPE_TEXT_MODEL="qwen3.5-plus-2026-02-15" \
DASHSCOPE_OCR_MODEL="qwen-vl-ocr-latest" \
AI_RESULT_REWRITE="0" \
pm2 restart guashake --update-env
```

## 12. 风险与后续建议
- 医疗合规：保持“信息辅助”定位，避免诊断口吻

## 13. 费用数据月更（湖北样板）
- 基础费用库：`data/cost-reference.common.json`
- 城市覆盖库：`data/cost-reference.hubei.city-overrides.json`
- 城市系数库（17地市）：`data/cost-reference.hubei.city-factors.json`
- 更新脚本：`scripts/update-hubei-cost-overrides.js`
- 官方来源台账：`data/cost-source.hubei.official.json`
- 导入校验脚本：`scripts/validate-hubei-cost-import.js`
- 月更一键脚本：`scripts/monthly-update-hubei-cost.sh`
- 导入模板：`data/imports/hubei/city-fees.template.json`

示例：
```bash
node scripts/update-hubei-cost-overrides.js --city 武汉 --item 挂号费 --min 8 --max 20
```

或批量：
```bash
node scripts/update-hubei-cost-overrides.js --city 黄石 --from-json ./tmp/huangshi-fees.json
```

月更流程（推荐）：
```bash
# 1) 先准备导入文件（参考 data/imports/hubei/city-fees.template.json）
# 2) 校验并导入
bash scripts/monthly-update-hubei-cost.sh 武汉 data/imports/hubei/wuhan-2026-04.json
```

说明：
- 目前已具备“17地市统一框架 + 城市系数 + 城市覆盖价”的完整链路。
- 官方来源台账已建好结构，链接状态区分为 `pending_review`，可按月补齐并固化。
- 数据准确性：前台显示更新时间与覆盖等级
- 审核策略：敏感词、疾病断言、夸大疗效必须拦截
- 隐私安全：上线前补齐鉴权、加密存储、访问审计

## 13. Git 提交流程（本仓库固定方式）
本仓库已配置为 **SSH 推送 GitHub**，远程地址：
- `origin = git@github.com:hbqchjy/guashake.git`

后续每次开发完成，统一用：
```bash
git add .
git commit -m "feat: 本次改动说明"
git push
```

首次校验（仅排障时需要）：
```bash
git remote -v
ssh -T git@github.com
```

说明：
- 已在当前 VPS 生成并配置 SSH key，可直接 push。
- 不再使用 HTTPS + PAT 方式。
