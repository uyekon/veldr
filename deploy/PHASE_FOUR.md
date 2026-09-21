# 阶段四：现有 Webadmin → App 同步（当前交付状态）

## 目标

把当前 CMS Webadmin 的资料作为第一个同步用户资料库导入移动端。该切片不创建新的空白 App 用户：生产 PostgreSQL 的 `CMS_OWNER_ID` 就是现有 Webadmin 资料的 owner。

## 已实现

- 后端登录在请求体携带 `client: "noteflow-mobile"` 时返回 Bearer 会话 JWT；浏览器登录仍只使用 httpOnly Cookie。
- App 在设备安全存储中保存服务器地址、会话 JWT、同步 cursor 和最近导入时间；不保存 Webadmin 密码。
- App 设置页提供“现有 Webadmin 同步”入口。连接后请求 `/api/v1/cms/sync/bootstrap`，将 Notebook、父子分类、标签、笔记和标准白板以服务端 UUID/版本导入本地 SQLite。
- 首次导入和手动更新都要求用户明确确认“以 Webadmin 资料替换本机”。若本机已有内容，界面提示先做完整 ZIP 备份。
- 已连接设备会把笔记、白板、Notebook 与分类创建写入本地 mutation outbox；重复保存同一实体会合并并保留稳定幂等 ID。
- “立即同步”会先上传 outbox，再按 cursor 分页拉取增量，不执行破坏性的 bootstrap 替换。
- 版本冲突保留本机 mutation 和服务器版本，界面提供“保留本机”和“使用服务器”选择。
- 后端与移动端自动化测试覆盖移动 JWT、Bearer、bootstrap、UUID 导入、outbox 上传、cursor 合并和冲突数据。

## 当前边界

这是可手动触发的文本同步基础，不是完整双向实时同步：

- 队列支持笔记创建/更新/删除、白板创建/更新、Notebook/分类创建；Notebook/分类的本地更新和删除尚未提供完整 UI 与队列映射。
- 原有离线资料升级到一个**已确认为空**的远端资料库时，可原子生成 Notebook、父子分类、笔记、白板的全量首次上传队列；后续上传会按该依赖顺序断点续传。远端已有资料时必须进入合并预览，当前版本不会自动覆盖；附件二进制另行处理。
- 附件二进制、视频和远程图片下载尚未导入应用私有目录。
- 文本冲突不做静默字段合并，必须由用户明确选择版本。
- 没有后台定时同步、推送、订阅账号或买断同步密钥库。

因此它适合先验证“现有 Webadmin 数据在 App 中可安全出现”，不应在生产环境把它描述为完整多端双向同步。

## 生产状态与连接条件

生产已完成 PostgreSQL 迁移并启用固定 `CMS_OWNER_ID`，`/api/health` 返回 `cmsStore: postgres`，旧 `/api/cms` 与 v1 路由均由 HTTPS 代理。App 仍必须只连接可信 HTTPS 域名；首次替换本地资料前先导出 ZIP 备份，导入后在飞行模式检查文章、分类和白板。

运行 App 时可指定服务器地址：

```bash
cd mobile
flutter run --dart-define=NOTEFLOW_SYNC_URL=https://cms.example.com
```

## 后续顺序

1. 完成 Notebook/分类更新删除和更完整的首次合并预览。
2. 下载、上传和去重附件二进制，处理大文件、断点续传和离线可读图片。
3. 在现有 change cursor 上增加后台刷新和 WebSocket/APNs/FCM 唤醒。
4. 将首个 Webadmin 兼容入口与订阅账号、买断同步密钥库隔离。
