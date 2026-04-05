#!/bin/bash
# 挂啥科服务监控
# 用法: bash deploy/monitor.sh
# 定时任务: crontab -e 添加: */5 * * * * /home/hulinbit/guahao/deploy/monitor.sh
# 每 5 分钟检查一次，挂了自动重启

set -e

PROJECT_DIR="/home/hulinbit/guahao"
LOG_FILE="$PROJECT_DIR/data/monitor.log"
HEALTH_URL="http://localhost:3000/api/health"
PM2_NAME="guashake"

# 可选：微信推送（使用 Server酱 https://sct.ftqq.com，免费）
# 注册后获取 SendKey，填在这里：
WECHAT_PUSH_KEY=""

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

notify() {
  local title="$1"
  local body="$2"
  log "ALERT: $title - $body"

  # 微信推送
  if [ -n "$WECHAT_PUSH_KEY" ]; then
    curl -s "https://sctapi.ftqq.com/${WECHAT_PUSH_KEY}.send" \
      -d "title=${title}" \
      -d "desp=${body}" > /dev/null 2>&1 || true
  fi
}

# 健康检查
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  # 服务正常，静默退出
  exit 0
fi

log "健康检查失败，HTTP状态码: $HTTP_CODE"

# 尝试用 PM2 重启
if command -v pm2 &> /dev/null; then
  # 检查 PM2 进程是否存在
  if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
    log "PM2 重启 $PM2_NAME..."
    pm2 restart "$PM2_NAME"
  else
    log "PM2 启动 $PM2_NAME..."
    cd "$PROJECT_DIR"
    pm2 start src/server.js --name "$PM2_NAME"
  fi
else
  # 没有 PM2，用 node 直接启动
  log "直接用 node 重启..."
  pkill -f "node src/server.js" 2>/dev/null || true
  sleep 2
  cd "$PROJECT_DIR"
  nohup node src/server.js >> "$PROJECT_DIR/data/server.log" 2>&1 &
fi

# 等待启动
sleep 5

# 再次检查
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  log "服务重启成功"
  notify "挂啥科服务已恢复" "服务曾短暂中断，已自动重启恢复正常。"
else
  log "服务重启失败！HTTP状态码: $HTTP_CODE"
  notify "挂啥科服务异常！" "服务健康检查持续失败（HTTP $HTTP_CODE），自动重启未成功，请手动检查服务器。"
fi

# 保持日志文件不超过 1MB
if [ -f "$LOG_FILE" ]; then
  SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 1048576 ]; then
    tail -500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
fi
