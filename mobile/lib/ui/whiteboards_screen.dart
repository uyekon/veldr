import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import '../core/theme.dart';
import '../data/models.dart';
import 'common.dart';

class WhiteboardsScreen extends StatelessWidget {
  const WhiteboardsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final boards = context
        .watch<AppState>()
        .whiteboards
        .where((item) => item.key != 'n')
        .toList();
    return PageFrame(
      child: ListView(
        padding: const EdgeInsets.only(bottom: 40),
        children: [
          const PageHeader('白板', subtitle: '把想法、计划与灵感整理成属于你的画布'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              children: [
                for (final board in boards) ...[
                  Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.all(16),
                      leading: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: AppColors.mint,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(
                          Icons.developer_board_outlined,
                          color: AppColors.forest,
                        ),
                      ),
                      title: Text(
                        board.title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      subtitle: Text(
                        _whiteboardPreview(board.content).isEmpty
                            ? '空白画布'
                            : excerpt(_whiteboardPreview(board.content)),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => WhiteboardEditorScreen(board: board),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class WhiteboardEditorScreen extends StatefulWidget {
  const WhiteboardEditorScreen({super.key, required this.board});
  final Whiteboard board;

  @override
  State<WhiteboardEditorScreen> createState() => _WhiteboardEditorScreenState();
}

class _WhiteboardEditorScreenState extends State<WhiteboardEditorScreen> {
  late final List<TextEditingController> cards = _parse(widget.board.content);
  late Whiteboard board = widget.board;
  bool saving = false;

  List<TextEditingController> _parse(String content) {
    final parts = _decodeWhiteboardCards(content);
    return parts
        .map((value) => TextEditingController(text: value.trim()))
        .toList();
  }

  @override
  void dispose() {
    for (final controller in cards) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.board.title),
      actions: [
        IconButton(
          tooltip: '新增卡片',
          onPressed: _addCard,
          icon: const Icon(Icons.add_box_outlined),
        ),
        TextButton.icon(
          onPressed: saving ? null : _save,
          icon: const Icon(Icons.save_outlined),
          label: const Text('保存'),
        ),
      ],
    ),
    body: PageFrame(
      child: ReorderableListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
        header: const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text(
            '长按卡片可以调整顺序；每张卡片都支持 Markdown。',
            style: TextStyle(color: AppColors.secondary),
          ),
        ),
        itemCount: cards.length,
        onReorderItem: (oldIndex, newIndex) {
          setState(() {
            cards.insert(newIndex, cards.removeAt(oldIndex));
          });
        },
        itemBuilder: (context, index) {
          final controller = cards[index];
          return Padding(
            key: ValueKey(controller),
            padding: const EdgeInsets.only(bottom: 12),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 8, 10, 14),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Text(
                          '卡片 ${index + 1}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const Spacer(),
                        if (cards.length > 1)
                          IconButton(
                            tooltip: '删除卡片',
                            onPressed: () => _removeCard(index),
                            icon: const Icon(Icons.close, size: 20),
                          ),
                        const Padding(
                          padding: EdgeInsets.all(12),
                          child: Icon(
                            Icons.drag_handle,
                            color: AppColors.secondary,
                          ),
                        ),
                      ],
                    ),
                    MarkdownToolbar(controller: controller),
                    const SizedBox(height: 4),
                    TextField(
                      controller: controller,
                      minLines: 5,
                      maxLines: null,
                      style: Theme.of(context).textTheme.bodyLarge,
                      decoration: const InputDecoration(
                        hintText: '记录一个想法、清单或链接…',
                        fillColor: AppColors.surface,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: _addCard,
      icon: const Icon(Icons.add),
      label: const Text('新卡片'),
    ),
  );

  void _addCard() {
    setState(() => cards.add(TextEditingController()));
  }

  void _removeCard(int index) {
    final removed = cards.removeAt(index);
    removed.dispose();
    setState(() {});
  }

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      board = await context.read<AppState>().saveWhiteboard(
        board.key,
        'noteflow-cards:v1\n${jsonEncode(cards.map((controller) => controller.text.trim()).toList())}',
        board.version,
      );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('已保存到本地')));
      }
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }
}

List<String> _decodeWhiteboardCards(String content) {
  const prefix = 'noteflow-cards:v1\n';
  if (!content.startsWith(prefix)) {
    return [content.trim()];
  }
  try {
    final decoded = jsonDecode(content.substring(prefix.length));
    if (decoded is List) {
      final cards = decoded.whereType<String>().toList();
      if (cards.isNotEmpty) return cards;
    }
  } catch (_) {
    // Keep malformed or future payloads visible instead of discarding them.
  }
  return [content.trim()];
}

String _whiteboardPreview(String content) =>
    _decodeWhiteboardCards(content)
        .where((value) => value.isNotEmpty)
        .join(' · ');
