#!/bin/bash
# 挂啥科数据库自动备份
# 用法: bash deploy/backup.sh
# 定时任务: crontab -e 添加: 0 3 * * * /home/hulinbit/guahao/deploy/backup.sh
# 每天凌晨3点自动备份

set -e

PROJECT_DIR="/home/hulinbit/guahao"
DB_FILE="$PROJECT_DIR/data/guashake.db"
BACKUP_DIR="$PROJECT_DIR/data/backups"
UPLOAD_DIR="$PROJECT_DIR/uploads"

# 保留最近 30 天的备份
KEEP_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)

# 备份数据库
if [ -f "$DB_FILE" ]; then
  BACKUP_FILE="$BACKUP_DIR/guashake_${DATE}.db"
  # 优先用 sqlite3 .backup（一致性快照），没有则用 cp
  if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
  else
    cp "$DB_FILE" "$BACKUP_FILE"
    # 也复制 WAL 文件（如果存在）
    [ -f "${DB_FILE}-wal" ] && cp "${DB_FILE}-wal" "${BACKUP_FILE}-wal"
  fi

  # 压缩
  gzip "$BACKUP_FILE"
  rm -f "${BACKUP_FILE}-wal" 2>/dev/null
  echo "[backup] 数据库备份完成: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
else
  echo "[backup] 数据库文件不存在: $DB_FILE"
fi

# 备份上传文件（增量打包）
if [ -d "$UPLOAD_DIR" ] && [ "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
  UPLOAD_BACKUP="$BACKUP_DIR/uploads_${DATE}.tar.gz"
  tar -czf "$UPLOAD_BACKUP" -C "$PROJECT_DIR" uploads/
  echo "[backup] 上传文件备份完成: $UPLOAD_BACKUP ($(du -h "$UPLOAD_BACKUP" | cut -f1))"
fi

# 清理旧备份
find "$BACKUP_DIR" -name "guashake_*.db.gz" -mtime +${KEEP_DAYS} -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +${KEEP_DAYS} -delete
echo "[backup] 已清理 ${KEEP_DAYS} 天前的旧备份"

# 显示备份目录大小
echo "[backup] 备份目录总大小: $(du -sh "$BACKUP_DIR" | cut -f1)"
