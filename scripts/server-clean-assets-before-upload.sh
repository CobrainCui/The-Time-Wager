#!/usr/bin/env bash
# 本地上传 dist 前在服务器执行（站点根目录示例路径请按实际修改）：
#   SITE_ROOT=/www/wwwroot/guangyinduidu.com
#   bash server-clean-assets-before-upload.sh "$SITE_ROOT"
set -euo pipefail
SITE_ROOT="${1:-/www/wwwroot/guangyinduidu.com}"
if [[ ! -d "$SITE_ROOT" ]]; then
  echo "missing site root: $SITE_ROOT" >&2
  exit 1
fi
rm -rf "${SITE_ROOT}/assets"
echo "removed ${SITE_ROOT}/assets — now unzip dist_upload.zip into ${SITE_ROOT}"
