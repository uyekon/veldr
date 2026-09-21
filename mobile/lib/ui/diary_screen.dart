import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../core/theme.dart';
import '../data/models.dart';
import 'common.dart';

class DiaryScreen extends StatefulWidget {
  const DiaryScreen({super.key});

  @override
  State<DiaryScreen> createState() => _DiaryScreenState();
}

class _DiaryScreenState extends State<DiaryScreen> with WidgetsBindingObserver {
  final controller = TextEditingController();
  Timer? timer;
  Whiteboard? board;
  bool dirty = false;
  bool saving = false;
  String status = '本地保存';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      timer?.cancel();
      _flush();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = context
        .watch<AppState>()
        .whiteboards
        .where((item) => item.key == 'n')
        .firstOrNull;
    if (board == null && next != null) {
      board = next;
      controller.text = next.content;
      controller.addListener(_changed);
    }
  }

  void _changed() {
    dirty = true;
    if (mounted) setState(() => status = '等待自动保存…');
    timer?.cancel();
    timer = Timer(const Duration(milliseconds: 700), _flush);
  }

  Future<void> _flush() async {
    if (saving || !dirty || board == null) return;
    saving = true;
    while (dirty && mounted) {
      dirty = false;
      final value = controller.text;
      setState(() => status = '自动保存中…');
      try {
        board = await context.read<AppState>().saveWhiteboard(
          'n',
          value,
          board!.version,
        );
        if (controller.text != value) dirty = true;
        if (mounted) setState(() => status = dirty ? '有新修改，继续保存…' : '已自动保存');
      } catch (_) {
        dirty = true;
        if (mounted) setState(() => status = '保存失败，内容仍保留');
        break;
      }
    }
    saving = false;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    controller.removeListener(_changed);
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PageFrame(
    child: ListView(
      padding: const EdgeInsets.only(bottom: 40),
      children: [
        const PageHeader('日记速记', subtitle: '记录当下的片段，沉淀为可整理的文章'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.calendar_today_outlined, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          DateFormat('yyyy年M月d日  HH:mm').format(DateTime.now()),
                        ),
                      ),
                      const Icon(
                        Icons.circle,
                        size: 9,
                        color: AppColors.forest,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        status,
                        style: const TextStyle(
                          color: AppColors.secondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    controller: controller,
                    minLines: 14,
                    maxLines: null,
                    style: Theme.of(context).textTheme.bodyLarge,
                    decoration: const InputDecoration(
                      hintText: '此刻想记录什么？',
                      fillColor: Colors.transparent,
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: _convert,
                    icon: const Icon(Icons.file_open_outlined),
                    label: const Text('转换为文章'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '转换时再选择 Notebook、分类和标签；成功后清空当前日记。',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.secondary, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );

  Future<void> _convert() async {
    await _flush();
    if (!mounted || board == null || controller.text.trim().isEmpty) return;
    final state = context.read<AppState>();
    var title = '日记 ${DateFormat('yyyy-MM-dd').format(DateTime.now())}';
    var notebookId = state.notebooks.first.id;
    String? categoryId;
    var tags = '日记';
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) {
          final categories = state.categories
              .where(
                (item) =>
                    item.notebookIds.isEmpty ||
                    item.notebookIds.contains(notebookId),
              )
              .toList();
          return Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              MediaQuery.viewInsetsOf(context).bottom + 20,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('转换为文章', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                TextFormField(
                  initialValue: title,
                  decoration: const InputDecoration(labelText: '标题'),
                  onChanged: (value) => title = value,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: notebookId,
                  decoration: const InputDecoration(labelText: 'Notebook'),
                  items: state.notebooks
                      .map(
                        (item) => DropdownMenuItem(
                          value: item.id,
                          child: Text(item.label),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setSheetState(() {
                    notebookId = value!;
                    categoryId = null;
                  }),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  initialValue: categoryId,
                  decoration: const InputDecoration(labelText: '分类'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('无分类')),
                    ...categories.map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.label),
                      ),
                    ),
                  ],
                  onChanged: (value) => setSheetState(() => categoryId = value),
                ),
                const SizedBox(height: 10),
                TextFormField(
                  initialValue: tags,
                  decoration: const InputDecoration(labelText: '标签'),
                  onChanged: (value) => tags = value,
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => Navigator.pop(sheetContext, true),
                    child: const Text('确认转换'),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await state.convertDiary(
        expectedVersion: board!.version,
        title: title,
        notebookId: notebookId,
        categoryId: categoryId,
        tags: tags
            .split(RegExp(r'[,，]'))
            .map((value) => value.trim())
            .where((value) => value.isNotEmpty)
            .toList(),
      );
      controller.removeListener(_changed);
      controller.clear();
      board = state.whiteboards.where((item) => item.key == 'n').firstOrNull;
      controller.addListener(_changed);
      dirty = false;
      if (mounted) setState(() => status = '已转换并清空');
    } catch (error) {
      if (mounted) showError(context, error);
    }
  }
}
