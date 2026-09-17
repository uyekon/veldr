# 阶段一交付与运维手册

## 实现范围

- 白板保存按白板 ID 排队；慢请求返回后保留新输入并继续提交。手动/自动保存共用队列，失败保留脏状态，网络恢复时重试。
- 文章手动保存等待已有自动保存；有新修改时保持编辑器打开，不误清理草稿。
- 日记转文章要求 `version` 与 `requestId`；版本冲突不清空，成功请求持久化去重，重启后可重试。
- 转换结果未确认时保留内容、锁定编辑并提供重试；响应丢失不能按新请求再次转换。刷新或强关前会提醒，但未上传内容在浏览器强关后不保证留存。
- 全部 CMS 数据写入经过串行副本提交，文件写入成功后才发布内存状态。保留 JSON，不支持多个后端写进程。
- 编辑角色可导出单篇 Markdown 和全部文章 ZIP；完整备份由管理脚本执行。
- 附件清理保护文章、归档文章、白板、旧快照和自定义页面仍引用的图片；视频删除也检查白板引用。

## 接口变更

`POST /api/cms/whiteboards/n/archive`：

```json
{
  "title": "日记文章",
  "notebookId": "notebook_work",
  "category": "work",
  "tags": ["journal"],
  "version": 3,
  "requestId": "随机生成的 UUID"
}
```

旧客户端缺少版本和请求 ID 返回 400，需刷新前端。请求 ID 支持 16–100 位字母、数字、下划线及连字符；相同 ID 参数不同返回 409。正常转换返回 201；重复成功请求返回 200 和 `replayed: true`，白板字段返回当前已提交状态，防止回放旧空白覆盖后来新写的日记。

`GET /api/cms/notes/:id/export`：Markdown，保留原附件 URL。

`GET /api/cms/export`：ZIP，所有文章（含 private/archived）、相对附件链接、元数据清单和缺失附件报告。ZIP 在临时目录流式生成后下载，结束后删除临时副本；导出期间暂停 CMS 写入及附件清理以获取一致内容。大库应在低使用时段执行。

两个导出接口都要求编辑权限。导出用于阅读迁移，不是整站恢复备份。

## 备份与校验

从 backend 工作目录运行，沿用 `.env` 中的数据路径。备份输出必须位于 Web 根目录之外，且不能放进数据/附件目录。

```bash
node scripts/cms-backup.js backup --backup-dir /opt/veldr/backups/cms
node scripts/cms-backup.js verify --source /opt/veldr/backups/cms/具体备份目录
```

每份备份是独立目录，包含 `db.json`、完整 `uploads/` 和 `manifest.json`。清单记录 SHA-256、格式版本、数量及时间；缺失文件、额外文件、符号链接、内容或数量不一致均拒绝验证。

保留最近 14 个成功的 daily 备份，以及最近 5 个 release/restore 安全备份；manual 备份不自动删除。失败备份不触发成功备份清理。可用 SCP 下载整个目录留在另一设备；服务器本地备份不能抵御整机丢失。

首次上线该功能后，由管理员安装 `deploy/veldr-cms-backup.service` 和 `.timer` 到 `/etc/systemd/system/`，核对 WorkingDirectory、Node 路径、备份目录后执行：

```bash
systemctl daemon-reload
systemctl enable --now veldr-cms-backup.timer
systemctl list-timers veldr-cms-backup.timer
journalctl -u veldr-cms-backup.service
```

计划北京时间每天 03:00 运行。本次开发没有在生产安装 timer。

## 恢复

先验证备份，再预览目标和数量；预览不会写入目标：

```bash
node scripts/cms-backup.js restore --dry-run \
  --source /opt/veldr/backups/cms/具体备份目录 \
  --db-file /opt/veldr/backend/public/data/cms/db.json \
  --upload-dir /opt/veldr/backend/public/uploads/cms
```

先停止后端和附件清理定时任务，确认没有其他写入进程，再在上述命令追加：

```text
--apply --service-stopped --service veldr-backend --confirm REPLACE_CMS_DATA
```

应用前自动备份现状，文件先准备到同级临时目录，再替换；普通替换错误会回退。旧目录以 `.previous` 保留，并在输出中列出。恢复后重启服务、核对文章/白板/附件，再恢复清理任务。异常断电或磁盘损坏需根据保留目录和安全备份人工恢复，不承诺跨目录的断电原子性。

当前自动恢复要求现有数据库和附件目录可读取，且数据库通过备份结构校验；现有文件已经损坏或丢失时会停止，不跳过安全备份强制覆盖。这类灾难恢复需先离线保全剩余文件，再由管理员恢复已验证的备份。

不要对运行中的后端执行外部数据修改，后端缓存已提交数据。共享锁位于 CMS 数据目录的 `.cms-operation.lock`，用于协调服务写入、备份和清理；等待超过 30 秒会失败。进程被强杀时锁可能残留，必须停止相关进程并检查 `owner.json` 后由管理员处理，工具不自动破锁。

## 固定提交构建与发布

构建不读取工作区修改，输出目录必须不存在：

```bash
node scripts/build-cms-release.mjs 提交SHA /opt/veldr-releases/新的版本目录
```

产物包含 `backend/`、`dist/` 和 SHA-256 清单；前后端各有 `release.json`。Node 20 与 npm、tar 为构建前提。将产物及 `scripts/cms-release.mjs` 上传至服务器的独立 staging 位置，脚本运行需 Node 20、systemd、Nginx、curl、npm。

确认生产服务仍使用 `/opt/veldr/backend`，Nginx 的实际根目录为 `/var/www/veldr-cms/dist` 后执行（仅发布时运行）：

```bash
node scripts/cms-release.mjs activate \
  --source /opt/veldr-releases/已上传版本目录 \
  --backend /opt/veldr/backend \
  --frontend /var/www/veldr-cms/dist \
  --service veldr-backend \
  --health-url http://127.0.0.1:5000/api/health \
  --site-url https://cms.lifetip.top/
```

发布会校验清单、目录、Nginx root、空间和服务状态，先备份数据，再安装新后端依赖、短暂停服、切换目录，验证首页及版本。失败恢复前一应用版本。`.env`、`public`、`var`、`temp`、`logs` 保留，通过链接继续使用；**不能删除输出的 previous 后端目录，其中可能保存仍在使用的运行数据。** 本流程有短暂维护窗口，不承诺零停机。

首次使用时直接加载 incoming release 中仅依赖 Node 内置模块的备份实现，不要求提前安装新后端依赖；使用当前后端配置计算出的绝对数据路径，绝不使用空的新目录作为备份源。备份涵盖 CMS 内容，不包括账号数据库或密钥，后者仍位于保留的运行目录，跨服务器迁移需另行管理。

人工应用回滚使用 activate 输出的确切 previous 路径：

```bash
node scripts/cms-release.mjs rollback \
  --backend /opt/veldr/backend --frontend /var/www/veldr-cms/dist \
  --previous-backend /opt/veldr/实际previous后端目录 \
  --previous-frontend /var/www/veldr-cms/实际previous前端目录 \
  --service veldr-backend \
  --health-url http://127.0.0.1:5000/api/health --site-url https://cms.lifetip.top/
```

回滚应用版本不会还原历史业务数据；数据恢复必须单独操作。

## 验证与剩余验收

```bash
cd backend
AUTH_COOKIE_NAME=veldr_auth AUTH_COOKIE_SECURE=false npm test
cd ../cms-frontend
npm test
npm run build
npm run test:e2e
```

后端测试的 ZIP 内容检查使用 `unzip`；浏览器测试需先安装匹配的 Chromium：`npx playwright install chromium`。

- 自动化覆盖保存队列、断网失败、固定白板计时器、丢响应重试、版本冲突、并发写入、磁盘失败回退、重启去重、导出权限和附件、损坏数据库、备份恢复、发布失败回滚与人工回滚。
- 本地验证：后端 25 项、前端 20 项单元／接口测试，桌面与移动视口 2 项浏览器测试；发布测试还覆盖连续发布后逐级回滚和回滚健康检查失败，确认最新运行数据保留。
- 浏览器测试在 mock API 下运行真实前端，覆盖桌面和 390px 手机视口的保存、弹窗、分类联动、转换及归档筛选；后端行为由独立接口测试验证。
- **待验收**：真实 iOS Safari / Android Chrome（含软键盘）、个人日常持续使用、生产首次维护发布、生产 timer 启用及真实数据恢复演练。本次测试没有访问或修改生产数据。
- npm 安装报告存在依赖审计告警；没有执行可能破坏兼容性的自动大版本升级。依赖专项升级不作为本次保存修复的隐含变更。
