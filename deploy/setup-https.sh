#!/bin/bash
# 挂啥科 HTTPS 配置脚本
# 用法: bash deploy/setup-https.sh your-domain.com
# 前提: 域名已解析到本服务器 IP

set -e

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
  echo "用法: bash deploy/setup-https.sh your-domain.com"
  exit 1
fi

echo "=== 1. 安装 certbot ==="
apt-get update -qq
apt-get install -y certbot python3-certbot-nginx

echo "=== 2. 生成 Nginx 配置 ==="
sed "s/YOUR_DOMAIN/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/guashake

# 先用 HTTP 配置获取证书
cat > /tmp/guashake-http.conf << EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

cp /tmp/guashake-http.conf /etc/nginx/sites-available/guashake
ln -sf /etc/nginx/sites-available/guashake /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 3. 申请 SSL 证书 ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email

echo "=== 4. 部署完整 HTTPS 配置 ==="
sed "s/YOUR_DOMAIN/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/guashake
nginx -t && systemctl reload nginx

echo "=== 5. 配置自动续期 ==="
# certbot 安装时已自动配置 systemd timer
systemctl enable certbot.timer
systemctl start certbot.timer

echo ""
echo "=== 完成！==="
echo "网站已部署到: https://$DOMAIN"
echo "SSL 证书会自动续期。"
