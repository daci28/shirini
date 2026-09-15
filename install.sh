#!/usr/bin/env bash
# ==============================================================================
# ShirinKam Pastry Bot & Admin Panel — Quick Installer (Single Command)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_DIR="/opt/shirini"
DATA_DIR="/var/lib/shirini-data"
REPO_URL="https://github.com/mahdi-newtry/shirini.git"

clear
echo -e "${CYAN}${BOLD}"
echo "================================================================"
echo "    🍰 اسکریپت نصب خودکار ربات و پنل قنادی شیرین‌کام            "
echo "================================================================"
echo -e "${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ لطفاً این اسکریپت را با دسترسی root اجرا کنید:${NC}"
  echo -e "   sudo bash <(curl -Ls https://raw.githubusercontent.com/mahdi-newtry/shirini/main/install.sh)"
  exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  OS="unknown"
fi

if [[ "$OS" != "ubuntu" && "$OS" != "debian" ]]; then
  echo -e "${YELLOW}⚠️ این اسکریپت روی Ubuntu و Debian تست شده است. ادامه داده می‌شود...${NC}"
fi

# 1. Ask Configuration
echo -e "${BLUE}⚙️ دریافت تنظیمات اولیه:${NC}"
echo ""

read -p "🤖 توکن ربات تلگرام (Enter برای تنظیم بعداً از پنل): " BOT_TOKEN
read -p "🌐 دامنه برای پنل مدیریت (مثال: panel.mysite.com یا خالی برای آی‌پی سرور): " DOMAIN_NAME
read -p "🔌 پورت اجرای برنامه (پیش‌فرض 3000): " APP_PORT
APP_PORT=${APP_PORT:-3000}

echo ""
echo -e "${GREEN}🚀 شروع فرآیند نصب... لطفاً چند دقیقه منتظر بمانید.${NC}"
echo ""

# 2. Update and install prerequisites
echo -e "${YELLOW}📦 [۱/۷] به‌روزرسانی مخازن و نصب ابزارهای پایه...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q curl git build-essential nginx certbot python3-certbot-nginx

# 3. Install Node.js 20 LTS
echo -e "${YELLOW}🟢 [۲/۷] نصب Node.js 20 LTS...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 -q
fi

# 4. Create persistent Data Directory
echo -e "${YELLOW}💾 [۳/۷] آماده‌سازی پوشه دائمی دیتابیس در ${DATA_DIR}...${NC}"
mkdir -p "$DATA_DIR"
chmod 755 "$DATA_DIR"

# 5. Clone or Update Repo
echo -e "${YELLOW}📥 [۴/۷] دانلود آخرین نسخه سورس کد...${NC}"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git reset --hard HEAD
  git pull
else
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# 6. Install NPM dependencies & Build
echo -e "${YELLOW}🔨 [۵/۷] نصب وابستگی‌ها و کامپایل پروژه (Build)...${NC}"
npm install --loglevel=error
npm run build

# 7. Create PM2 Ecosystem config
echo -e "${YELLOW}⚙️ [۶/۷] ساخت کانفیگ سرویس PM2...${NC}"
cat <<EOF > "$APP_DIR/ecosystem.config.cjs"
module.exports = {
  apps: [
    {
      name: 'shirini',
      script: 'dist/server.cjs',
      cwd: '$APP_DIR',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: $APP_PORT,
        DATA_DIR: '$DATA_DIR',
        TELEGRAM_BOT_TOKEN: '${BOT_TOKEN:-}'
      },
      restart_delay: 4000,
      max_memory_restart: '400M'
    }
  ]
};
EOF

# Start / Restart with PM2
pm2 delete shirini 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# 8. Setup Nginx and SSL if domain provided
echo -e "${YELLOW}🌐 [۷/۷] پیکربندی وب‌سرور...${NC}"
if [ -n "$DOMAIN_NAME" ]; then
  cat <<EOF > "/etc/nginx/sites-available/shirini"
server {
    listen 80;
    server_name $DOMAIN_NAME;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
  ln -sf "/etc/nginx/sites-available/shirini" "/etc/nginx/sites-enabled/shirini"
  rm -f "/etc/nginx/sites-enabled/default" 2>/dev/null || true
  nginx -t && systemctl restart nginx

  echo -e "${CYAN}🔒 دریافت گواهی SSL رایگان Let's Encrypt برای ${DOMAIN_NAME}...${NC}"
  certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email -d "$DOMAIN_NAME" || {
    echo -e "${YELLOW}⚠️ صدور SSL ناموفق بود (احتمالاً هنوز DNS ست نشده است). می‌توانید بعداً با دستور 'certbot --nginx -d $DOMAIN_NAME' بگیرید.${NC}"
  }
fi

# 9. Create convenient CLI management command `shirini`
cat <<'EOF' > /usr/local/bin/shirini
#!/usr/bin/env bash
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

case "$1" in
  start)
    pm2 start shirini
    ;;
  stop)
    pm2 stop shirini
    ;;
  restart)
    pm2 restart shirini
    ;;
  status)
    pm2 status shirini
    ;;
  logs)
    pm2 logs shirini --lines "${2:-100}"
    ;;
  update)
    echo -e "${YELLOW}🔄 دریافت آخرین آپدیت از گیت‌هاب...${NC}"
    cd /opt/shirini
    git reset --hard HEAD
    git pull
    npm install
    npm run build
    pm2 restart shirini
    echo -e "${GREEN}✅ آپدیت با موفقیت انجام شد.${NC}"
    ;;
  backup)
    BACKUP_FILE="/root/shirini-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "$BACKUP_FILE" -C /var/lib/shirini-data .
    echo -e "${GREEN}✅ فایل پشتیبان ساخته شد:${NC} $BACKUP_FILE"
    ;;
  *)
    echo -e "${CYAN}🍰 دستورات مدیریت قنادی شیرین‌کام:${NC}"
    echo "  shirini status    -> مشاهده وضعیت برنامه"
    echo "  shirini logs      -> مشاهده لاگ زنده"
    echo "  shirini restart   -> ری‌استارت سرویس"
    echo "  shirini update    -> آپدیت خودکار به آخرین نسخه گیت‌هاب"
    echo "  shirini backup    -> ساخت فایل بکاپ از تمام داده‌ها"
    echo "  shirini stop      -> توقف سرویس"
    echo "  shirini start     -> شروع سرویس"
    ;;
esac
EOF
chmod +x /usr/local/bin/shirini

SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}🎉 نصب با موفقیت انجام شد و برنامه در حال اجراست!${NC}"
echo -e "${GREEN}${BOLD}================================================================${NC}"
echo ""
if [ -n "$DOMAIN_NAME" ]; then
  echo -e "🌐 آدرس پنل مدیریت: ${CYAN}https://${DOMAIN_NAME}${NC}"
else
  echo -e "🌐 آدرس پنل مدیریت: ${CYAN}http://${SERVER_IP}:${APP_PORT}${NC}"
fi
echo -e "👤 نام کاربری پیش‌فرض: ${YELLOW}admin${NC}"
echo -e "🔑 کلمه عبور پیش‌فرض:  ${YELLOW}admin${NC}"
echo -e "💾 مسیر ذخیره دائمی دیتابیس: ${CYAN}${DATA_DIR}${NC}"
echo ""
echo -e "${BOLD}📌 دستورات مدیریت سریع در سرور:${NC}"
echo -e "  - دیدن لاگ‌ها:   ${CYAN}shirini logs${NC}"
echo -e "  - آپدیت برنامه: ${CYAN}shirini update${NC}"
echo -e "  - بکاپ‌گیری:     ${CYAN}shirini backup${NC}"
echo -e "  - وضعیت سرویس:  ${CYAN}shirini status${NC}"
echo ""
