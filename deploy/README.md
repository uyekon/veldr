# Veldr / NoteFlow 生产部署

## 当前生产布局

```text
cms.lifetip.top / notes.lifetip.top -> /var/www/veldr-cms/dist
veldr.lifetip.top                   -> /var/www/veldr/dist
API                                 -> 127.0.0.1:5000
后端代码                            -> /opt/veldr/backend
PostgreSQL                          -> 本机 veldr_cms
```

后端使用 `veldr-backend.service`，Node 路径为 `/usr/local/bin/node`。环境配置位于运行目录的 `.env`，不进入 Git，也不得复制到发布产物。

## 固定提交发布

发布前要求工作区干净、目标提交已推送：

```bash
cd /opt/veldr-repo
git status --short
COMMIT=$(git rev-parse HEAD)
node scripts/build-cms-release.mjs "$COMMIT" "/opt/veldr-releases/${COMMIT:0:8}-cms"
```

激活：

```bash
node scripts/cms-release.mjs activate \
  --source "/opt/veldr-releases/${COMMIT:0:8}-cms" \
  --backend /opt/veldr/backend \
  --frontend /var/www/veldr-cms/dist \
  --service veldr-backend \
  --health-url http://127.0.0.1:5000/api/health \
  --site-url https://cms.lifetip.top/
```

脚本会验证提交产物、空间、Nginx 根目录和服务状态。`CMS_STORE=postgres` 时先执行 PostgreSQL 自定义格式 dump、附件 SHA-256 校验和 restic 异地复制；失败时不进入停服和目录切换。`CMS_STORE=json` 才使用 JSON 发布快照。

激活失败会自动恢复上一代码版本。手动回滚必须使用激活输出的 `previousBackend` 和 `previousFrontend`，不要猜测目录，也不要回滚运行时数据。

## 发布后检查

```bash
curl -fsS https://cms.lifetip.top/api/health
curl -fsS https://cms.lifetip.top/release.json
systemctl status veldr-backend --no-pager
journalctl -u veldr-backend --since '-15 minutes' --no-pager
systemctl list-timers --all --no-pager | grep veldr
```

`release.json` 的 commit 必须等于发布提交；健康检查必须返回 `status: ok` 与 `cmsStore: postgres`。

## PostgreSQL 备份与恢复

```bash
cd /opt/veldr/backend
node scripts/cms-postgres-backup.js backup --backup-dir /opt/veldr/backups/cms-postgres
node scripts/cms-postgres-backup.js verify --source /opt/veldr/backups/cms-postgres/具体备份目录
```

恢复先做预览，只允许使用独立测试数据库和独立附件目录演练。生产恢复前必须停服、停止清理 timer、再次安全备份并明确确认目标。完整迁移和恢复参数见 [PHASE_TWO.md](PHASE_TWO.md)。

## systemd

仓库模板位于 `deploy/systemd/`。模板复制到 `/etc/systemd/system/` 后必须执行：

```bash
systemctl daemon-reload
systemctl restart veldr-cms-postgres-backup.timer
systemctl restart veldr-cms-upload-cleanup.timer
systemctl status veldr-cms-postgres-backup.timer --no-pager
systemctl status veldr-cms-upload-cleanup.timer --no-pager
```

不要在普通应用发布中改动共享 443 SNI 路由。Nginx 与 sing-box 共用 443 的结构记录在 `deploy/nginx/`，修改前必须完整审查所有域名映射。
