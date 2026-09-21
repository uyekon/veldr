import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../core/theme.dart';
import 'common.dart';

class LibraryScreen extends StatelessWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return PageFrame(
      child: ListView(
        padding: const EdgeInsets.only(bottom: 40),
        children: [
          const PageHeader('资料库', subtitle: '管理本地 Notebook、分类和标签'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _LibraryCard(
                  title: '笔记本',
                  icon: Icons.menu_book_outlined,
                  count: state.notebooks.length,
                  children: [
                    ...state.notebooks.map(
                      (item) => ListTile(
                        title: Text(item.label),
                        leading: const Icon(Icons.folder_outlined),
                      ),
                    ),
                    ListTile(
                      leading: const Icon(Icons.add),
                      title: const Text('新建 Notebook'),
                      onTap: () => _createNotebook(context),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _LibraryCard(
                  title: '分类',
                  icon: Icons.account_tree_outlined,
                  count: state.categories.length,
                  children: [
                    ...state.categories.map(
                      (item) => ListTile(
                        title: Text(item.label),
                        subtitle: Text(
                          [
                            if (item.parentId != null)
                              '属于 ${state.categories.where((candidate) => candidate.id == item.parentId).firstOrNull?.label ?? '上级分类'}',
                            if (item.notebookIds.isNotEmpty)
                              state.notebooks
                                  .where(
                                    (notebook) =>
                                        item.notebookIds.contains(notebook.id),
                                  )
                                  .map((notebook) => notebook.label)
                                  .join('、')
                            else
                              '所有 Notebook',
                          ].join(' · '),
                        ),
                        leading: const Icon(Icons.sell_outlined),
                      ),
                    ),
                    ListTile(
                      leading: const Icon(Icons.add),
                      title: const Text('新建分类'),
                      onTap: () => _createCategory(context),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _LibraryCard(
                  title: '标签',
                  icon: Icons.tag,
                  count: state.tags.length,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: state.tags.map(TagChip.new).toList(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Card(
                  child: ListTile(
                    contentPadding: EdgeInsets.all(16),
                    leading: Icon(
                      Icons.archive_outlined,
                      color: AppColors.forest,
                    ),
                    title: Text('归档笔记'),
                    subtitle: Text('在笔记页使用“已归档”筛选查看'),
                    trailing: Icon(Icons.chevron_right),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _createNotebook(BuildContext context) async {
    final value = await textPrompt(context, '新建 Notebook', '名称');
    if (value != null && context.mounted) {
      await context.read<AppState>().createNotebook(value);
    }
  }

  Future<void> _createCategory(BuildContext context) async {
    final state = context.read<AppState>();
    final controller = TextEditingController();
    String? parentId;
    String? notebookId = state.notebookFilter;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('新建分类'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(labelText: '分类名称'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: parentId,
                decoration: const InputDecoration(labelText: '上级分类'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('无上级分类')),
                  ...state.categories.map(
                    (item) => DropdownMenuItem(
                      value: item.id,
                      child: Text(item.label),
                    ),
                  ),
                ],
                onChanged: (value) => setDialogState(() => parentId = value),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: notebookId,
                decoration: const InputDecoration(labelText: '所属 Notebook'),
                items: [
                  const DropdownMenuItem(
                    value: null,
                    child: Text('所有 Notebook'),
                  ),
                  ...state.notebooks.map(
                    (item) => DropdownMenuItem(
                      value: item.id,
                      child: Text(item.label),
                    ),
                  ),
                ],
                onChanged: (value) => setDialogState(() => notebookId = value),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('创建'),
            ),
          ],
        ),
      ),
    );
    final value = controller.text.trim();
    controller.dispose();
    if (confirmed == true && value.isNotEmpty && context.mounted) {
      await state.createCategory(
        value,
        parentId: parentId,
        notebookIds: notebookId == null ? const [] : [notebookId!],
      );
    }
  }
}

class _LibraryCard extends StatelessWidget {
  const _LibraryCard({
    required this.title,
    required this.icon,
    required this.count,
    required this.children,
  });
  final String title;
  final IconData icon;
  final int count;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    child: Column(
      children: [
        ListTile(
          contentPadding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          leading: Icon(icon, color: AppColors.forest),
          title: Text(title, style: Theme.of(context).textTheme.titleMedium),
          trailing: Text('$count 个'),
        ),
        const Divider(height: 1),
        ...children,
      ],
    ),
  );
}
