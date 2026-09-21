import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../app_state.dart';
import '../core/theme.dart';
import '../data/models.dart';
import 'common.dart';

class NotesScreen extends StatelessWidget {
  const NotesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final pinned = state.notes.where((note) => note.pinned).toList();
    final recent = state.notes.where((note) => !note.pinned).toList();
    final categories = state.categories
        .where(
          (category) =>
              state.notebookFilter == null ||
              category.notebookIds.isEmpty ||
              category.notebookIds.contains(state.notebookFilter),
        )
        .toList();
    final visibleTags = state.tags
        .where((tag) => tag.toLowerCase() != 'archived')
        .toList();
    return PageFrame(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: FloatingActionButton(
          onPressed: () => _openEditor(context),
          backgroundColor: AppColors.forest,
          foregroundColor: Colors.white,
          child: const Icon(Icons.edit),
        ),
        body: RefreshIndicator(
          onRefresh: state.refresh,
          child: CustomScrollView(
            slivers: [
              const SliverToBoxAdapter(child: PageHeader('笔记')),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Column(
                    children: [
                      TextField(
                        onChanged: debounce(state.setSearch),
                        decoration: const InputDecoration(
                          prefixIcon: Icon(Icons.search),
                          hintText: '搜索笔记、标签或内容…',
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: DropdownButtonFormField<String?>(
                              initialValue: state.notebookFilter,
                              decoration: const InputDecoration(
                                prefixIcon: Icon(Icons.folder_outlined),
                                isDense: true,
                              ),
                              items: [
                                const DropdownMenuItem(
                                  value: null,
                                  child: Text('全部笔记'),
                                ),
                                ...state.notebooks.map(
                                  (item) => DropdownMenuItem(
                                    value: item.id,
                                    child: Text(item.label),
                                  ),
                                ),
                              ],
                              onChanged: state.filterNotebook,
                            ),
                          ),
                          const SizedBox(width: 10),
                          FilterChip(
                            selected: state.archivedOnly,
                            label: const Text('已归档'),
                            onSelected: state.showArchived,
                          ),
                        ],
                      ),
                      if (categories.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String?>(
                          initialValue: state.categoryFilter,
                          decoration: const InputDecoration(
                            prefixIcon: Icon(Icons.account_tree_outlined),
                            isDense: true,
                          ),
                          items: [
                            const DropdownMenuItem(
                              value: null,
                              child: Text('全部分类'),
                            ),
                            ...categories.map(
                              (item) => DropdownMenuItem(
                                value: item.id,
                                child: Text(item.label),
                              ),
                            ),
                          ],
                          onChanged: state.filterCategory,
                        ),
                      ],
                      if (visibleTags.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: visibleTags
                                .map(
                                  (tag) => ChoiceChip(
                                    label: Text('#$tag'),
                                    selected: state.tagFilter == tag,
                                    onSelected: (selected) =>
                                        state.filterTag(selected ? tag : null),
                                  ),
                                )
                                .toList(),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (state.error != null)
                SliverToBoxAdapter(
                  child: ErrorCard(error: state.error!, onRetry: state.refresh),
                ),
              if (pinned.isNotEmpty) ...[
                const SliverToBoxAdapter(
                  child: SectionTitle(
                    icon: Icons.push_pin_outlined,
                    label: '置顶',
                  ),
                ),
                _NotesSliver(notes: pinned),
              ],
              SliverToBoxAdapter(
                child: SectionTitle(label: state.archivedOnly ? '已归档' : '最近更新'),
              ),
              if (recent.isEmpty && pinned.isEmpty)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyState(
                    icon: Icons.note_add_outlined,
                    text: '还没有笔记，写下第一条吧',
                  ),
                )
              else
                _NotesSliver(notes: recent),
              const SliverToBoxAdapter(child: SizedBox(height: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openEditor(BuildContext context) async {
    final state = context.read<AppState>();
    final now = DateTime.now().toUtc();
    final note = Note(
      id: const Uuid().v7(),
      title: '',
      content: '',
      notebookId: state.notebooks.firstOrNull?.id,
      createdAt: now,
      updatedAt: now,
    );
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NoteEditorScreen(note: note, isNew: true),
      ),
    );
  }
}

class _NotesSliver extends StatelessWidget {
  const _NotesSliver({required this.notes});
  final List<Note> notes;

  @override
  Widget build(BuildContext context) => SliverPadding(
    padding: const EdgeInsets.symmetric(horizontal: 20),
    sliver: SliverList.separated(
      itemCount: notes.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) => NoteCard(note: notes[index]),
    ),
  );
}

class NoteCard extends StatelessWidget {
  const NoteCard({super.key, required this.note});
  final Note note;

  @override
  Widget build(BuildContext context) => Card(
    child: InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => NoteDetailScreen(noteId: note.id)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (note.pinned) ...[
                  const Icon(Icons.push_pin, size: 16, color: AppColors.forest),
                  const SizedBox(width: 6),
                ],
                Expanded(
                  child: Text(
                    note.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  relativeTime(note.updatedAt),
                  style: const TextStyle(
                    color: AppColors.secondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            if (note.content.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                excerpt(note.content),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.secondary),
              ),
            ],
            if (note.tags.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: note.tags.take(4).map(TagChip.new).toList(),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}

class NoteDetailScreen extends StatefulWidget {
  const NoteDetailScreen({super.key, required this.noteId});
  final String noteId;

  @override
  State<NoteDetailScreen> createState() => _NoteDetailScreenState();
}

class _NoteDetailScreenState extends State<NoteDetailScreen> {
  Note? note;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    note = await context.read<AppState>().repository.getNote(widget.noteId);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final current = note;
    if (current == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final state = context.watch<AppState>();
    final notebook = state.notebooks
        .where((item) => item.id == current.notebookId)
        .firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('笔记'),
        actions: [
          IconButton(
            tooltip: '编辑',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => NoteEditorScreen(note: current),
                ),
              );
              await _load();
            },
          ),
          IconButton(
            tooltip: current.isArchived ? '取消归档' : '归档',
            icon: Icon(
              current.isArchived
                  ? Icons.unarchive_outlined
                  : Icons.archive_outlined,
            ),
            onPressed: () async {
              await state.archive(current, !current.isArchived);
              if (context.mounted) Navigator.pop(context);
            },
          ),
          PopupMenuButton<String>(
            tooltip: '更多',
            onSelected: (value) => _handleAction(value, current),
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'pin',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    current.pinned ? Icons.push_pin_outlined : Icons.push_pin,
                  ),
                  title: Text(current.pinned ? '取消置顶' : '置顶'),
                ),
              ),
              const PopupMenuItem(
                value: 'delete',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.delete_outline),
                  title: Text('删除笔记'),
                ),
              ),
            ],
          ),
        ],
      ),
      body: PageFrame(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 60),
          children: [
            Text(
              current.title,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                if (notebook != null)
                  MetaPill(
                    icon: Icons.menu_book_outlined,
                    label: notebook.label,
                  ),
                ...current.tags.map(TagChip.new),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              '创建于 ${DateFormat('yyyy-MM-dd HH:mm').format(current.createdAt.toLocal())}  ·  最近修改 ${DateFormat('yyyy-MM-dd HH:mm').format(current.updatedAt.toLocal())}',
              style: const TextStyle(color: AppColors.secondary, fontSize: 12),
            ),
            const Divider(height: 32),
            SelectionArea(
              child: MarkdownBody(
                data: current.content.isEmpty ? '_暂无正文_' : current.content,
                selectable: true,
                imageBuilder: (uri, title, alt) {
                  if (uri.scheme != 'attachment') {
                    return Text(alt ?? uri.toString());
                  }
                  return FutureBuilder<File>(
                    future: state.attachmentService.resolve(uri.path),
                    builder: (context, snapshot) {
                      if (!snapshot.hasData) {
                        return const SizedBox(
                          height: 120,
                          child: Center(child: CircularProgressIndicator()),
                        );
                      }
                      return ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.file(snapshot.data!, fit: BoxFit.cover),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleAction(String value, Note current) async {
    final state = context.read<AppState>();
    if (value == 'pin') {
      try {
        await state.saveNote(
          current.copyWith(pinned: !current.pinned),
          expectedVersion: current.version,
        );
        await _load();
      } catch (error) {
        if (mounted) showError(context, error);
      }
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除这篇笔记？'),
        content: const Text('笔记将从本机资料库中移除。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await state.deleteNote(current);
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) showError(context, error);
    }
  }
}

class NoteEditorScreen extends StatefulWidget {
  const NoteEditorScreen({super.key, required this.note, this.isNew = false});
  final Note note;
  final bool isNew;

  @override
  State<NoteEditorScreen> createState() => _NoteEditorScreenState();
}

class _NoteEditorScreenState extends State<NoteEditorScreen> {
  late final TextEditingController title = TextEditingController(
    text: widget.note.title,
  );
  late final TextEditingController content = TextEditingController(
    text: widget.note.content,
  );
  late final TextEditingController tags = TextEditingController(
    text: widget.note.tags.join('，'),
  );
  late String? notebookId = widget.note.notebookId;
  late String? categoryId = widget.note.categoryId;
  late bool pinned = widget.note.pinned;
  late AppState appState;
  bool dependenciesReady = false;
  bool saving = false;
  bool committed = false;
  final pendingAttachments = <String>[];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!dependenciesReady) {
      appState = context.read<AppState>();
      dependenciesReady = true;
    }
  }

  @override
  void dispose() {
    if (!committed) {
      for (final filename in pendingAttachments) {
        appState.attachmentService.delete(filename);
      }
    }
    title.dispose();
    content.dispose();
    tags.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final available = state.categories
        .where(
          (category) =>
              category.notebookIds.isEmpty ||
              category.notebookIds.contains(notebookId),
        )
        .toList();
    if (categoryId != null && !available.any((item) => item.id == categoryId)) {
      categoryId = null;
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isNew ? '新建笔记' : '编辑笔记'),
        actions: [
          TextButton.icon(
            onPressed: saving ? null : _save,
            icon: saving
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_outlined),
            label: const Text('保存'),
          ),
        ],
      ),
      body: PageFrame(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            TextField(
              controller: title,
              maxLength: 500,
              style: Theme.of(context).textTheme.headlineMedium,
              decoration: const InputDecoration(
                hintText: '笔记标题',
                counterText: '',
                fillColor: Colors.transparent,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    initialValue: notebookId,
                    decoration: const InputDecoration(
                      labelText: 'Notebook',
                      prefixIcon: Icon(Icons.menu_book_outlined),
                    ),
                    items: state.notebooks
                        .map(
                          (item) => DropdownMenuItem(
                            value: item.id,
                            child: Text(item.label),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setState(() => notebookId = value),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    initialValue: categoryId,
                    decoration: const InputDecoration(
                      labelText: '分类',
                      prefixIcon: Icon(Icons.sell_outlined),
                    ),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('无分类')),
                      ...available.map(
                        (item) => DropdownMenuItem(
                          value: item.id,
                          child: Text(item.label),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => categoryId = value),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: tags,
              decoration: const InputDecoration(
                labelText: '标签',
                hintText: '用逗号分隔',
                prefixIcon: Icon(Icons.tag),
              ),
            ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: const Text('置顶笔记'),
              subtitle: const Text('置顶后优先显示在列表顶部'),
              value: pinned,
              onChanged: (value) => setState(() => pinned = value),
            ),
            const SizedBox(height: 12),
            MarkdownToolbar(controller: content, onImage: _insertImage),
            const SizedBox(height: 8),
            TextField(
              controller: content,
              minLines: 18,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              style: Theme.of(context).textTheme.bodyLarge,
              decoration: const InputDecoration(
                hintText: '开始写作…',
                fillColor: AppColors.surface,
                alignLabelWithHint: true,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      final parsedTags = tags.text
          .split(RegExp(r'[,，]'))
          .map((value) => value.trim())
          .where((value) => value.isNotEmpty)
          .toSet()
          .toList();
      final state = context.read<AppState>();
      await state.saveNote(
        widget.note.copyWith(
          title: title.text,
          content: content.text,
          notebookId: notebookId,
          categoryId: categoryId,
          clearCategoryId: categoryId == null,
          tags: parsedTags,
          pinned: pinned,
        ),
        expectedVersion: widget.isNew ? null : widget.note.version,
        attachmentFilenames: pendingAttachments,
      );
      committed = true;
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _insertImage() async {
    try {
      final state = context.read<AppState>();
      final filename = await state.attachmentService.pickImage();
      if (filename == null || !mounted) return;
      pendingAttachments.add(filename);
      final insertion = '\n![图片](attachment:$filename)\n';
      final selection = content.selection;
      final offset = selection.isValid ? selection.start : content.text.length;
      content.value = TextEditingValue(
        text: content.text.replaceRange(offset, offset, insertion),
        selection: TextSelection.collapsed(offset: offset + insertion.length),
      );
      setState(() {});
    } catch (error) {
      if (mounted) showError(context, error);
    }
  }
}
