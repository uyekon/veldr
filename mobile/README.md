# NoteFlow Mobile

NoteFlow 的 Flutter 本地优先客户端。当前阶段无需账号或网络，iOS 与 Android 数据只保存在设备上的 SQLite 和应用附件目录中；Web 端仍继续通过 API 使用服务端数据。

## 已实现

- 笔记创建、查看、编辑、软删除、搜索、置顶与归档
- Notebook、父子分类、分类和 Notebook 绑定、标签
- 日记串行自动保存，以及“转文章＋清空日记”的本地事务
- 五个标准白板（`n`、`t`、`w`、`dp`、`ideas`）
- Markdown 编辑/预览、图片附件、Markdown 批量导入导出
- SQLite 与附件完整 ZIP 备份、校验恢复
- 乐观版本检查；发生过期写入时拒绝静默覆盖

## 本地开发

要求 Flutter stable 3.47 或更高版本。首次运行：

```bash
flutter pub get
flutter analyze
flutter test
flutter run
```

iOS 构建和真机验证必须在安装 Xcode 的 macOS 上执行：

```bash
flutter build ios --release --no-codesign
```

Android release 需要本机 Android SDK 和签名配置。仓库不包含账号、订阅或云同步代码，这些属于阶段四及阶段五。

## 数据位置与恢复语义

数据库文件名为 `noteflow.sqlite`，附件位于 Application Support 的 `attachments/`。完整恢复会先在临时目录解包附件并校验路径，然后替换本地数据库快照；失败时回滚原附件目录。Markdown 导入只新增文章，不覆盖已有数据。

详细验收范围见 [`../deploy/PHASE_THREE.md`](../deploy/PHASE_THREE.md)。
