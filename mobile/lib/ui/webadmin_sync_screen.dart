import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../core/theme.dart';
import '../data/webadmin_sync_service.dart';
import '../data/sync_outbox.dart';
import 'common.dart';

class WebadminSyncScreen extends StatefulWidget {
  const WebadminSyncScreen({super.key});

  @override
  State<WebadminSyncScreen> createState() => _WebadminSyncScreenState();
}

class _WebadminSyncScreenState extends State<WebadminSyncScreen> {
  static const defaultServer = String.fromEnvironment(
    'NOTEFLOW_SYNC_URL',
    defaultValue: 'https://cms.lifetip.top',
  );

  final server = TextEditingController(text: defaultServer);
  final username = TextEditingController(text: 'admin');
  final password = TextEditingController();
  SyncSession? session;
  int pendingMutations = 0;
  int conflictCount = 0;
  bool loading = true;
  bool working = false;

  @override
  void initState() {
    super.initState();
    _loadSession();
  }

  @override
  void dispose() {
    server.dispose();
    username.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> _loadSession() async {
    try {
      final state = context.read<AppState>();
      final value = await state.currentWebadminSession();
      final pending = value == null
          ? 0
          : await state.webadminSync.pendingLocalMutations();
      final conflicts = value == null
          ? const <PendingSyncMutation>[]
          : await state.webadminConflicts();
      if (mounted) {
        setState(() {
          session = value;
          pendingMutations = pending;
          conflictCount = conflicts.length;
        });
      }
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('现有 Webadmin 同步')),
    body: PageFrame(
      child: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
              children: [
                const Icon(
                  Icons.sync_lock_outlined,
                  color: AppColors.forest,
                  size: 42,
                ),
                const SizedBox(height: 12),
                Text(
                  session == null ? '把已有资料带到这台设备' : '这台设备已连接',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 8),
                const Text(
                  '笔记始终先保存到本机。连接后可手动上传本机变更并拉取服务器增量；首次导入仍需明确确认。',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.secondary),
                ),
                const SizedBox(height: 24),
                if (session == null)
                  _connectCard(context)
                else
                  _connectedCard(context),
                const SizedBox(height: 14),
                const _InfoCard(
                  icon: Icons.info_outline,
                  title: '首次连接会导入什么？',
                  body: 'Notebook、分类、标签、文章和标准白板会保持 Webadmin 的 UUID 与版本。附件二进制同步将在后续版本开放。',
                ),
                const SizedBox(height: 12),
                const _InfoCard(
                  icon: Icons.lock_outline,
                  title: '凭据仅保存在设备安全存储中',
                  body: '密码只用于换取会话授权，不会写入本地资料库。退出连接会删除本机授权。',
                ),
              ],
            ),
    ),
  );

  Widget _connectCard(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('连接现有 Webadmin', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          const Text(
            '使用当前 CMS 后台的管理员凭据完成首次迁移。',
            style: TextStyle(color: AppColors.secondary),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: server,
            keyboardType: TextInputType.url,
            autocorrect: false,
            enableSuggestions: false,
            decoration: const InputDecoration(
              labelText: '服务器地址',
              hintText: 'https://cms.example.com',
              prefixIcon: Icon(Icons.dns_outlined),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: username,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Webadmin 用户名',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: password,
            obscureText: true,
            enableSuggestions: false,
            autocorrect: false,
            onSubmitted: (_) => _confirmAndConnect(),
            decoration: const InputDecoration(
              labelText: '密码',
              prefixIcon: Icon(Icons.key_outlined),
            ),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: working ? null : _confirmAndConnect,
            icon: working
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_download_outlined),
            label: Text(working ? '正在导入…' : '连接并导入 Webadmin 数据'),
          ),
        ],
      ),
    ),
  );

  Widget _connectedCard(BuildContext context) {
    final current = session!;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.mint,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.cloud_done_outlined,
                    color: AppColors.forest,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Webadmin 已连接',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        current.serverBaseUrl,
                        style: const TextStyle(color: AppColors.secondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 28),
            Text(
              '同步游标 ${current.cursor}',
              style: const TextStyle(color: AppColors.secondary),
            ),
            if (current.lastSyncedAt != null) ...[
              const SizedBox(height: 4),
              Text(
                '最近导入 ${DateFormat('yyyy-MM-dd HH:mm').format(current.lastSyncedAt!.toLocal())}',
                style: const TextStyle(color: AppColors.secondary),
              ),
            ],
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: pendingMutations == 0
                    ? AppColors.mint
                    : AppColors.sandChip,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(
                    pendingMutations == 0
                        ? Icons.check_circle_outline
                        : Icons.cloud_upload_outlined,
                    color: AppColors.forest,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    pendingMutations == 0
                        ? '没有待上传的本机变更'
                        : '$pendingMutations 项本机变更等待同步',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (conflictCount > 0) ...[
              OutlinedButton.icon(
                onPressed: working ? null : _openConflicts,
                icon: const Icon(Icons.call_split_outlined),
                label: Text('$conflictCount 项同步冲突需要处理'),
              ),
              const SizedBox(height: 8),
            ],
            FilledButton.icon(
              onPressed: working ? null : _syncNow,
              icon: const Icon(Icons.sync),
              label: Text(working ? '正在同步…' : '同步当前设备'),
            ),
            const SizedBox(height: 8),
            FilledButton.tonalIcon(
              onPressed: working ? null : _confirmAndRefresh,
              icon: const Icon(Icons.refresh),
              label: Text(working ? '正在更新…' : '重新导入服务器资料'),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: working ? null : _disconnect,
              icon: const Icon(Icons.link_off_outlined),
              label: const Text('退出此设备连接'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmAndConnect() async {
    if (server.text.trim().isEmpty ||
        username.text.trim().isEmpty ||
        password.text.isEmpty) {
      showError(context, '请填写服务器地址、用户名和密码');
      return;
    }
    final state = context.read<AppState>();
    if (!await _confirmReplace() || !mounted) return;
    setState(() => working = true);
    try {
      final value = await state.connectWebadminAndReplace(
        serverBaseUrl: server.text,
        username: username.text,
        password: password.text,
      );
      password.clear();
      if (mounted) setState(() => session = value);
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> _confirmAndRefresh() async {
    final state = context.read<AppState>();
    if (!await _confirmReplace() || !mounted) return;
    setState(() => working = true);
    try {
      final value = await state.refreshWebadminFromServer();
      if (mounted) setState(() => session = value);
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> _syncNow() async {
    final state = context.read<AppState>();
    setState(() => working = true);
    try {
      final result = await state.synchronizeWebadmin();
      if (!mounted) return;
      setState(() {
        session = result.session;
        pendingMutations = 0;
        conflictCount = 0;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('已上传 ${result.uploaded} 项，下载 ${result.downloaded} 项变更'),
        ),
      );
    } catch (error) {
      if (mounted) {
        await _loadSession();
        if (mounted) showError(context, error);
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> _openConflicts() async {
    final state = context.read<AppState>();
    final conflicts = await state.webadminConflicts();
    if (!mounted || conflicts.isEmpty) return;
    final mutation = conflicts.first;
    final resolved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${_entityLabel(mutation)} 的同步冲突'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('请比较三个版本后选择。不会自动覆盖任何一方。'),
                const SizedBox(height: 14),
                _versionBlock('共同基准', mutation.basePayload),
                _versionBlock('本机修改', mutation.payload),
                _versionBlock('服务器当前版本', mutation.serverPayload),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('稍后处理'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('使用服务器版本'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('保留本机内容'),
          ),
        ],
      ),
    );
    if (resolved == null || !mounted) return;
    setState(() => working = true);
    try {
      await state.resolveWebadminConflict(mutation, keepLocal: resolved);
      await _loadSession();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(resolved ? '已保留本机内容，下一次同步会重新提交' : '已使用服务器版本')),
        );
      }
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  static String _entityLabel(PendingSyncMutation mutation) =>
      switch (mutation.entityType) {
        'note' => '笔记',
        'whiteboard' => '白板',
        'category' => '分类',
        'notebook' => 'Notebook',
        _ => '内容',
      };

  static Widget _versionBlock(String label, Map<String, Object?>? payload) {
    final content =
        payload?['content']?.toString() ??
        payload?['label']?.toString() ??
        payload?['title']?.toString() ??
        '无可显示内容';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 3),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.sandChip,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(content, maxLines: 6, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }

  Future<bool> _confirmReplace() async {
    final state = context.read<AppState>();
    final hasLocalContent =
        state.notes.isNotEmpty ||
        state.whiteboards.any((board) => board.content.trim().isNotEmpty);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('以 Webadmin 资料替换本机？'),
        content: Text(
          hasLocalContent
              ? '本机已有笔记或白板。继续后将以服务器当前资料替换本机资料库，建议先在“设置 → 备份与恢复”导出完整备份。'
              : '将下载当前 Webadmin 的全部资料到本机。之后仍可离线阅读和编辑。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('继续导入'),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _disconnect() async {
    await context.read<AppState>().disconnectWebadmin();
    if (mounted) setState(() => session = null);
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.icon,
    required this.title,
    required this.body,
  });
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.forest),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(color: AppColors.secondary)),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
