import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../core/theme.dart';
import 'common.dart';
import 'webadmin_sync_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) => PageFrame(
    child: ListView(
      padding: const EdgeInsets.only(bottom: 40),
      children: [
        const PageHeader('设置', subtitle: '保护隐私与本地数据安全'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            children: [
              const _SettingCard(
                icon: Icons.folder_outlined,
                title: '本地存储',
                body: '所有笔记、白板和元数据都保存在本设备；没有登录也能完整使用。',
                badge: '仅保存在本设备',
              ),
              const SizedBox(height: 12),
              const _SettingCard(
                icon: Icons.shield_outlined,
                title: '隐私保护',
                body: '当前版本不会上传或分析你的个人内容。',
                badge: '数据由你控制',
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '备份与恢复',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        '完整备份包含数据库与附件；Markdown 适合迁移和长期留存。恢复完整备份会替换当前资料库。',
                        style: TextStyle(color: AppColors.secondary),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.tonalIcon(
                              onPressed: () => _export(context),
                              icon: const Icon(Icons.ios_share),
                              label: const Text('导出备份'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _restore(context),
                              icon: const Icon(Icons.restore),
                              label: const Text('恢复备份'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton.tonalIcon(
                              onPressed: () => _exportMarkdown(context),
                              icon: const Icon(Icons.description_outlined),
                              label: const Text('导出 Markdown'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _importMarkdown(context),
                              icon: const Icon(Icons.file_open_outlined),
                              label: const Text('导入 Markdown'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(16),
                  leading: const Icon(
                    Icons.sync_lock_outlined,
                    color: AppColors.forest,
                  ),
                  title: const Text('现有 Webadmin 同步'),
                  subtitle: const Text('把当前 CMS 管理端资料明确导入这台设备'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const WebadminSyncScreen(),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const _SettingCard(
                icon: Icons.sync_disabled_outlined,
                title: '同步（未来可用）',
                body: '订阅账号实时同步与买断同步密钥库将在后续阶段开放。',
                badge: '规划中',
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Future<void> _export(BuildContext context) async {
    try {
      await context.read<AppState>().backupService.shareBackup();
    } catch (error) {
      if (context.mounted) showError(context, error);
    }
  }

  Future<void> _restore(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('恢复本地备份？'),
        content: const Text('当前本地数据将被备份文件替换。请确认你已另存当前资料。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('继续'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await context.read<AppState>().restoreBackup();
    } catch (error) {
      if (context.mounted) showError(context, error);
    }
  }

  Future<void> _exportMarkdown(BuildContext context) async {
    try {
      await context.read<AppState>().backupService.shareMarkdownExport();
    } catch (error) {
      if (context.mounted) showError(context, error);
    }
  }

  Future<void> _importMarkdown(BuildContext context) async {
    try {
      final count = await context.read<AppState>().importMarkdown();
      if (context.mounted && count > 0) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('已导入 $count 篇 Markdown 笔记')));
      }
    } catch (error) {
      if (context.mounted) showError(context, error);
    }
  }
}

class _SettingCard extends StatelessWidget {
  const _SettingCard({
    required this.icon,
    required this.title,
    required this.body,
    required this.badge,
  });
  final IconData icon;
  final String title;
  final String body;
  final String badge;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.forest, size: 30),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 6),
                Text(body, style: const TextStyle(color: AppColors.secondary)),
                const SizedBox(height: 10),
                TagChip(badge),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
