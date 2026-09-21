# 阶段四：现有 Webadmin → App 同步（第一切片）

## 目标

把当前 CMS Webadmin 的资料作为第一个同步用户资料库导入移动端。该切片不创建新的空白 App 用户：生产 PostgreSQL 的 `CMS_OWNER_ID` 就是现有 Webadmin 资料的 owner。

## 已实现

- 后端登录在请求体携带 `client: "noteflow-mobile"` 时返回 Bearer 会话 JWT；浏览器登录仍只使用 httpOnly Cookie。
- App 在设备安全存储中保存服务器地址、会话 JWT、同步 cursor 和最近导入时间；不保存 Webadmin 密码。
- App 设置页提供“现有 Webadmin 同步”入口。连接后请求 `/api/v1/cms/sync/bootstrap`，将 Notebook、父子分类、标签、笔记和标准白板以服务端 UUID/版本导入本地 SQLite。
- 首次导入和手动更新都要求用户明确确认“以 Webadmin 资料替换本机”。若本机已有内容，界面提示先做完整 ZIP 备份。
- 后端与移动端均有自动化测试覆盖移动 JWT、Bearer 验证、bootstrap 解析和 UUID 导入。

## 当前边界

这个切片是安全的 **Webadmin → App 单向导入/刷新**，不是完整双向实时同步：

- 已连接设备会先把笔记、白板、Notebook 与分类变更写入本地 mutation outbox。队列上传器已支持按顺序发送笔记与白板的创建/更新、以及 Notebook/分类创建；成功后回写服务端版本并移除队列项，失败或 `409` 会保留队列并停止，绝不静默覆盖。上传入口、冲突处理界面和 cursor 拉取尚未接入正式 UI；未连接的本地用户不会创建这些记录或访问 API。
- 原有离线资料升级到一个**已确认为空**的远端资料库时，可原子生成 Notebook、父子分类、笔记、白板的全量首次上传队列；后续上传会按该依赖顺序断点续传。远端已有资料时必须进入合并预览，当前版本不会自动覆盖；附件二进制另行处理。
- 附件二进制、视频和远程图片下载尚未导入应用私有目录。
- 未提供本地与服务器内容自动合并；用户必须选择替换，避免静默数据丢失。
- 没有后台定时同步、推送、订阅账号或买断同步密钥库。

因此它适合先验证“现有 Webadmin 数据在 App 中可安全出现”，不应在生产环境把它描述为完整多端双向同步。

## 生产接入前置条件

1. 依照 [阶段二手册](PHASE_TWO.md) 把生产 JSON 数据演练并迁移到 PostgreSQL，生成固定且保密的 `CMS_OWNER_ID`。
2. 用导入后的数据检查 v1 bootstrap：文章、Notebook、分类、标签、白板、媒体和附件计数、UUID 和内容摘要应一致。
3. 将 `CMS_STORE=postgres` 后执行一次 Webadmin 登录和旧 `/api/cms` 兼容回归。
4. 只在 HTTPS 的正式域名下为 App 配置 `NOTEFLOW_SYNC_URL`，不要让用户在不可信 HTTP 服务器输入管理员密码。
5. App 首次连接前导出本地 ZIP 备份；确认导入后检查飞行模式下的文章、分类与白板可读取。

运行 App 时可指定服务器地址：

```bash
cd mobile
flutter run --dart-define=NOTEFLOW_SYNC_URL=https://cms.example.com
```

## 后续顺序

1. 完成本地 mutation outbox 的上传：服务端已接受客户端生成 UUID 的 Notebook、分类、笔记和白板创建；仍需接入移动端批量上传、版本冲突界面和幂等重试，实现 Webadmin ↔ App 双向同步。
2. 下载和去重附件二进制，处理大文件、断点续传和离线可读图片。
3. 以 change cursor、WebSocket/推送触发增量同步，而非每次重新 bootstrap。
4. 将首个 Webadmin 兼容入口与后续订阅账号、买断同步密钥库隔离。
