# 阶段二：PostgreSQL 与跨设备数据基础

## 已实现范围

- CMS 可通过 `CMS_STORE=json|postgres` 切换存储；默认仍为 `json`，仅设置数据库地址不会自动切换生产数据。
- PostgreSQL 使用显式版本迁移，包含用户、导航、分类与 Notebook 关系、文章、标签、白板、媒体、幂等记录和变更日志。
- 旧 `/api/cms` 的数字文章 ID、字符串分类/Notebook/白板 ID 与筛选行为保持兼容。
- 新 `/api/v1/cms` 使用 UUID，写入要求 `mutationId`，更新和删除要求 `baseVersion`。
- `sync/bootstrap` 返回一致性快照及游标；`sync/changes` 返回按序增量变更和删除墓碑。
- JSON→PostgreSQL 导入支持 dry-run、引用校验、内容摘要验证和反向 JSON 导出。
- PostgreSQL 自定义格式备份包含附件副本和 SHA-256 清单，可使用 restic 加密复制到 SFTP 服务器。

本阶段不包括公开注册、订阅、支付、移动端客户端和冲突合并界面。安全 SQLite 在兼容期继续负责现有登录；个人账号 UUID、密码哈希和会话版本同时写入 PostgreSQL，为后续账号迁移准备数据。

## 配置

生成一次并长期保留个人账号 UUID：

```bash
node -e "console.log(require('crypto').randomUUID())"
```

生产 `.env` 增加：

```text
CMS_STORE=json
CMS_DATABASE_URL=postgresql://veldr_cms:强密码@127.0.0.1:5432/veldr_cms
CMS_DATABASE_SSL=false
CMS_DATABASE_POOL_MAX=10
CMS_OWNER_ID=生成的UUID
CMS_POSTGRES_BACKUP_DIR=/opt/veldr/backups/cms-postgres
RESTIC_REPOSITORY=sftp:备份用户@备份服务器:/srv/restic/veldr-cms
RESTIC_PASSWORD_FILE=/etc/veldr/restic-password
```

数据库账号只授予 `veldr_cms` 数据库权限；PostgreSQL 仅监听本机。restic 密码文件权限设为 `0600`，SSH 固定远端主机公钥，不使用关闭主机密钥校验的参数。

## 迁移演练

先对最新 JSON 执行只读检查：

```bash
cd /opt/veldr/backend
node scripts/cms-postgres-migrate.js verify \
  --source public/data/cms/db.json --upload-dir public/uploads/cms
node scripts/cms-postgres-migrate.js import \
  --source public/data/cms/db.json --upload-dir public/uploads/cms
```

第二条默认仍是 dry-run。测试数据库正式导入：

```bash
CMS_DATABASE_URL=postgresql://.../veldr_cms_rehearsal \
node scripts/cms-postgres-migrate.js import \
  --source public/data/cms/db.json --upload-dir public/uploads/cms --apply
```

工具拒绝重复 ID、分类循环、缺失父分类、悬空 Notebook、无效文章 ID，以及同时存在 `dp` 和 `dailyPush`。缺失的标准白板会创建为空白白板；`dailyPush` 规范化为 `dp`。

导入后输出的数量和 `contentDigest` 必须与 dry-run 一致。

## 生产切换

1. 完成现有 JSON、SQLite、安全数据库和附件 release 备份，并验证清单。
2. 停止后端及附件清理 timer，确认站点不再接受写入。
3. 执行最终 dry-run，然后导入生产 PostgreSQL：

```bash
node scripts/cms-postgres-migrate.js import \
  --source public/data/cms/db.json --upload-dir public/uploads/cms --apply
```

4. 将 `.env` 中 `CMS_STORE=json` 改为 `CMS_STORE=postgres`，重启后端。
5. `/api/health` 必须返回 `status: ok` 和 `cmsStore: postgres`。
6. 验证登录、文章列表、Notebook/分类/标签筛选、编辑、置顶、归档、五个白板、日记转换、图片、视频和导出。
7. 验证新接口的 bootstrap、changes、重复 mutation、版本冲突和删除墓碑。
8. 恢复附件清理 timer，观察日志和备份任务至少 24 小时。

该流程需要约 5–10 分钟维护窗口，不启用 JSON/PostgreSQL 双写。

## 回滚

如果 PostgreSQL 已产生新写入，禁止直接恢复切换前 JSON。先停写并导出最新兼容 JSON：

```bash
node scripts/cms-postgres-migrate.js export \
  --output /opt/veldr/rollback/cms-db-回滚时间.json
```

校验导出文件后，将其放入旧版本预期的数据位置，再把 `CMS_STORE` 改回 `json` 并回滚应用。输出文件使用排他创建，目标已存在时拒绝覆盖。

## PostgreSQL 与异地备份

手动备份及验证：

```bash
node scripts/cms-postgres-backup.js backup \
  --backup-dir /opt/veldr/backups/cms-postgres

node scripts/cms-postgres-backup.js verify \
  --source /opt/veldr/backups/cms-postgres/具体备份目录
```

配置 `RESTIC_REPOSITORY` 和 `RESTIC_PASSWORD_FILE` 后，成功的本机备份会自动加密上传，并保留 14 个日备份、8 个周备份、12 个月备份。本地成功但异地上传失败会令整个任务失败并进入 systemd 日志。

安装 `deploy/systemd/veldr-cms-postgres-backup.service` 和 `.timer` 后：

```bash
systemctl daemon-reload
systemctl enable --now veldr-cms-postgres-backup.timer
systemctl start veldr-cms-postgres-backup.service
systemctl status veldr-cms-postgres-backup.service
```

恢复预览不会修改目标：

```bash
node scripts/cms-postgres-backup.js restore \
  --source /opt/veldr/backups/cms-postgres/具体备份目录 \
  --target-url postgresql://.../隔离恢复数据库
```

隔离恢复必须使用独立数据库和独立附件目录：

```bash
node scripts/cms-postgres-backup.js restore \
  --source /opt/veldr/backups/cms-postgres/具体备份目录 \
  --target-url postgresql://.../veldr_cms_restore_test \
  --target-upload-dir /opt/veldr/restore-test/uploads/cms \
  --apply --confirm REPLACE_CMS_POSTGRES
```

工具拒绝把 `/`、当前工作目录或其父目录作为附件恢复目标。对生产恢复前仍须停服、创建安全备份并人工确认准确目标。

## v1 同步契约

- `GET /api/v1/cms/sync/bootstrap`：返回 `entities` 和当前 `cursor`。
- `GET /api/v1/cms/sync/changes?cursor=0&limit=100`：最多 500 条，返回 `nextCursor` 和 `hasMore`。
- 文章、Notebook、分类写入使用 UUID；更新和删除携带整数 `baseVersion`。
- 每次写入携带 16–100 位的 `mutationId`。相同 ID和相同载荷返回原结果并标记 `replayed`；相同 ID不同载荷返回 409。
- 版本冲突返回 409 和 `VERSION_CONFLICT`，客户端不得自动覆盖。
- 删除产生 tombstone；普通列表和 bootstrap 不返回软删除实体。
- `owner_id` 只取自认证上下文，不接受客户端传入。
- `entities.attachments` 和 `GET /api/v1/cms/attachments` 返回附件路径、MIME、大小及 SHA-256；新增上传和清理都会产生附件变更记录。

媒体二进制上传在本阶段继续复用 `/api/cms/upload` 和 `/api/cms/media`；v1 bootstrap/media 返回 UUID 元数据。附件分块和断点续传留到同步阶段。
