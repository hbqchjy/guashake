#!/bin/bash
# 挂啥科一键部署/更新脚本
# 用法: bash deploy/deploy.sh
# 拉最新代码 → 构建前端 → 重启后端

set -e

PROJECT_DIR="/home/hulinbit/guahao"
PM2_NAME="guashake"

cd "$PROJECT_DIR"

echo "=== 1. 拉取最新代码 ==="
git pull origin main

echo "=== 2. 安装后端依赖 ==="
npm install --production

echo "=== 3. 构建前端 ==="
cd v1
npm install
npx vite build
cd "$PROJECT_DIR"

echo "=== 4. 重启后端服务 ==="
if command -v pm2 &> /dev/null; then
  if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
    pm2 restart "$PM2_NAME"
  else
    pm2 start src/server.js --name "$PM2_NAME"
  fi
  pm2 save
else
  echo "提示: 未安装 PM2，请先运行: npm install -g pm2"
  echo "然后运行: pm2 start src/server.js --name guashake"
fi

echo ""
echo "=== 部署完成！==="
echo "前端: $PROJECT_DIR/v1/dist/"
echo "后端: pm2 status $PM2_NAME"
