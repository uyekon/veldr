# Veldr / NoteFlow 技术交接

更新时间：2026-09-21

代码目录：`/opt/veldr-repo`

分支：`main`

远端：`github-lifetip:uyekon/veldr.git`

## 当前状态

- NoteFlow CMS 已在生产使用 PostgreSQL，`GET /api/health` 应返回 `cmsStore: postgres`。
- CMS Web 通过服务端 API 读写，不使用 IndexedDB 保存业务数据。
- Flutter App 已具备离线本地版，以及 Webadmin 文本数据的前台手动同步试验链路。
- 当前生产发布以站点 `/release.json` 为准；不要从未提交工作区直接构建。
- 本文件不保存管理员密码、JWT、数据库密码、备份密码或 SSH 私钥。

## 生产布局

| 项目 | 位置或名称 |
|---|---|
| 源代码 | `/opt/veldr-repo` |
| 后端运行目录 | `/opt/veldr/backend` |
| CMS 前端目录 | `/var/www/veldr-cms/dist` |
| 后端服务 | `veldr-backend.service` |
| PostgreSQL 数据库 | `veldr_cms`，仅本机访问 |
| CMS 域名 | `https://cms.lifetip.top` |
| PostgreSQL 备份 | `/opt/veldr/backups/cms-postgres` |
| 发布产物 | `/opt/veldr-releases` |

定时任务：

- `veldr-cms-postgres-backup.timer`：每日 03:00（Asia/Shanghai），自带随机延迟。
- `veldr-cms-upload-cleanup.timer`：每日 03:20，自带随机延迟。
- PostgreSQL 备份包含 `database.dump`、全部 CMS 上传文件和 SHA-256 清单；配置 restic 后会同步异地。

## 已完成能力

### Web/CMS

- 统一管理员 Cookie/JWT 会话、登录限流和密码变更后会话失效。
- Notebook、父子分类、分类多 Notebook 绑定、标签作用域、置顶和归档筛选。
- 五个标准白板、日记自动保存及“转文章并清空日记”的幂等事务流程。
- Markdown 编辑、预览、段落与列表缩进、独立折叠项、图片粘贴/拖放和最大 500 MB 视频上传。
- 自动保存串行化、版本冲突判断、本地草稿和显式冲突选择。
- Markdown/ZIP 导出、附件清理、发布回滚与备份恢复工具。

### PostgreSQL 与同步基础

- 生产已从 JSON 切换到 PostgreSQL；旧 `/api/cms` 保持兼容。
- `/api/v1/cms` 使用 UUID、`mutationId`、`baseVersion`、软删除墓碑和游标增量。
- Webadmin 既有数据归属于固定 `CMS_OWNER_ID`，是第一份 App 同步资料库。
- App 已支持文本实体 outbox 上传、游标增量拉取和“保留本机/使用服务器”冲突处理。

### 移动端本地版

- SQLite 本地优先，未连接同步时不会产生业务 API 流量。
- 离线笔记、日记、白板、分类、标签、图片和完整 ZIP 备份恢复。
- Linux 环境下 Flutter 静态检查与自动化测试已通过；iOS 真机验收仍需 macOS/Xcode。

## 发布与回滚

构建固定提交：

```bash
cd /opt/veldr-repo
git status --short
git rev-parse HEAD
node scripts/build-cms-release.mjs COMMIT /opt/veldr-releases/唯一目录名
```

激活发布：

```bash
node scripts/cms-release.mjs activate \
  --source /opt/veldr-releases/唯一目录名 \
  --backend /opt/veldr/backend \
  --frontend /var/www/veldr-cms/dist \
  --service veldr-backend \
  --health-url http://127.0.0.1:5000/api/health \
  --site-url https://cms.lifetip.top/
```

发布脚本会先检查空间、Nginx 路径、服务状态和产物哈希。生产为 PostgreSQL 时，必须先完成原生 PostgreSQL、附件及异地备份；任一步骤失败都会停止发布。JSON 模式才使用旧的 `db.json` 快照。

激活成功会输出 `previousBackend` 和 `previousFrontend`。需要回滚时，使用同一脚本的 `rollback` 命令并显式传入这两个目录；运行时数据不随代码目录回滚。

## 验证命令

```bash
cd /opt/veldr-repo/backend
TEST_CMS_DATABASE_URL=postgresql://独立测试账号@127.0.0.1:5432/独立测试库 npm test

cd /opt/veldr-repo/cms-frontend
npm test
npm run build
npm run test:e2e

cd /opt/veldr-repo/frontend
npm ci
npm run build

cd /opt/veldr-repo/mobile
/opt/flutter-sdk/bin/flutter analyze
/opt/flutter-sdk/bin/flutter test
```

生产发布后至少检查：

```bash
curl -fsS https://cms.lifetip.top/api/health
curl -fsS https://cms.lifetip.top/release.json
systemctl status veldr-backend --no-pager
systemctl list-timers --all --no-pager
journalctl -u veldr-backend --since '-15 minutes' --no-pager
```

## 备份恢复注意事项

- 发布前备份与每日备份必须使用 `backend/scripts/cms-postgres-backup.js`。
- 先对备份执行 `verify`；恢复先使用不带 `--apply` 的预览模式。
- 恢复演练只能使用独立数据库和独立附件目录，禁止把测试恢复指向生产路径。
- PostgreSQL 已产生新写入后，不得用旧 `db.json` 覆盖生产。

## 明确未完成

- App 附件二进制上传、下载、去重、断点续传及跨端离线附件。
- Notebook/分类在 App 中的完整更新、删除同步，以及后台自动同步。
- WebSocket、APNs/FCM 唤醒和接近实时同步。
- 订阅账号、StoreKit 权益、买断同步密钥库、多用户资料库和账号删除。
- Xcode 签名、iOS release、真机中文输入/飞行模式/恢复测试和 TestFlight。

这些任务不应被描述为已完成。附件同步和商业服务端并非必须依赖 Mac，而是本轮按范围主动延期。

## 已知技术债

- `frontend/` 的旧 TinyMCE/Vite 链存在需跨主版本解决的依赖公告；生产 CMS 不使用该 TinyMCE。升级时需单独回归 Veldr 文章编辑器。
- Sequelize 6 内部依赖旧 UUID 包，当前审计为中风险；不得按审计建议降级 Sequelize，应在后续数据库层升级或移除旧 ORM 时解决。
- CMS 的运行时 `config.js` 故意使用普通脚本注入，Vite 构建会提示不能打包，但不影响产物。
