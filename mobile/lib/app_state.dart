import 'package:flutter/foundation.dart' hide Category;

import 'data/backup_service.dart';
import 'data/attachment_service.dart';
import 'data/models.dart';
import 'data/note_repository.dart';
import 'data/webadmin_sync_service.dart';
import 'data/sync_outbox.dart';

class AppState extends ChangeNotifier {
  AppState(this.repository, {WebadminBootstrapSync? webadminSync})
    : attachmentService = AttachmentService(),
      backupService = BackupService(repository),
      webadminSync = webadminSync ?? WebadminBootstrapSync(repository);

  final NoteRepository repository;
  final AttachmentService attachmentService;
  final BackupService backupService;
  final WebadminBootstrapSync webadminSync;
  List<Note> notes = const [];
  List<Notebook> notebooks = const [];
  List<Category> categories = const [];
  List<Whiteboard> whiteboards = const [];
  List<String> tags = const [];
  String search = '';
  String? notebookFilter;
  String? categoryFilter;
  String? tagFilter;
  bool archivedOnly = false;
  bool loading = true;
  Object? error;

  Future<void> initialize() async {
    await refresh();
  }

  Future<void> refresh() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      notebooks = await repository.listNotebooks();
      categories = await repository.listCategories();
      whiteboards = await repository.listWhiteboards();
      tags = await repository.listTags();
      notes = await repository.listNotes(
        search: search,
        notebookId: notebookFilter,
        categoryId: categoryFilter,
        tag: tagFilter,
        archivedOnly: archivedOnly,
      );
    } catch (value) {
      error = value;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> setSearch(String value) async {
    search = value;
    await _refreshNotes();
  }

  Future<void> filterNotebook(String? id) async {
    notebookFilter = id;
    if (categoryFilter != null &&
        !categories.any(
          (category) =>
              category.id == categoryFilter &&
              (notebookFilter == null ||
                  category.notebookIds.isEmpty ||
                  category.notebookIds.contains(notebookFilter)),
        )) {
      categoryFilter = null;
    }
    await _refreshNotes();
  }

  Future<void> filterCategory(String? id) async {
    categoryFilter = id;
    await _refreshNotes();
  }

  Future<void> filterTag(String? value) async {
    tagFilter = value;
    await _refreshNotes();
  }

  Future<void> showArchived(bool value) async {
    archivedOnly = value;
    await _refreshNotes();
  }

  Future<Note> saveNote(
    Note note, {
    int? expectedVersion,
    Iterable<String> attachmentFilenames = const [],
  }) async {
    final saved = await repository.saveNote(
      note,
      expectedVersion: expectedVersion,
      attachmentFilenames: attachmentFilenames,
    );
    await webadminSync.recordNoteSave(
      saved,
      previousVersion: expectedVersion,
      baseNote: note,
    );
    await refresh();
    return saved;
  }

  Future<void> archive(Note note, bool value) async {
    final saved = await repository.setArchived(note, value);
    await webadminSync.recordNoteSave(
      saved,
      previousVersion: note.version,
      baseNote: note,
    );
    await refresh();
  }

  Future<void> deleteNote(Note note) async {
    await repository.softDelete(note);
    await webadminSync.recordNoteDelete(note);
    await refresh();
  }

  Future<Whiteboard> saveWhiteboard(
    String key,
    String content,
    int expectedVersion,
  ) async {
    final board = await repository.saveWhiteboard(
      key,
      content,
      expectedVersion,
    );
    await webadminSync.recordWhiteboardSave(
      board,
      previousVersion: expectedVersion,
    );
    await refresh();
    return board;
  }

  Future<Note> convertDiary({
    required int expectedVersion,
    required String title,
    required String notebookId,
    String? categoryId,
    List<String> tags = const ['日记'],
  }) async {
    final note = await repository.convertDiary(
      expectedVersion: expectedVersion,
      title: title,
      notebookId: notebookId,
      categoryId: categoryId,
      tags: tags,
    );
    await webadminSync.recordNoteSave(note);
    final diary = await repository.getWhiteboard('n');
    if (diary != null) {
      await webadminSync.recordWhiteboardSave(
        diary,
        previousVersion: expectedVersion,
      );
    }
    await refresh();
    return note;
  }

  Future<void> createNotebook(String label) async {
    final notebook = await repository.createNotebook(label);
    await webadminSync.recordNotebookCreate(notebook);
    await refresh();
  }

  Future<void> createCategory(
    String label, {
    String? parentId,
    List<String> notebookIds = const [],
  }) async {
    final category = await repository.createCategory(
      label: label,
      parentId: parentId,
      notebookIds: notebookIds,
    );
    await webadminSync.recordCategoryCreate(category);
    await refresh();
  }

  Future<void> restoreBackup() async {
    if (await backupService.pickAndRestore()) await refresh();
  }

  Future<int> importMarkdown() async {
    final count = await backupService.pickAndImportMarkdown();
    if (count > 0) await refresh();
    return count;
  }

  Future<SyncSession?> currentWebadminSession() =>
      webadminSync.currentSession();

  Future<SyncSession> connectWebadminAndReplace({
    required String serverBaseUrl,
    required String username,
    required String password,
  }) async {
    final session = await webadminSync.connectAndReplace(
      serverBaseUrl: serverBaseUrl,
      username: username,
      password: password,
    );
    await refresh();
    return session;
  }

  Future<SyncSession> refreshWebadminFromServer() async {
    final session = await webadminSync.refreshFromServer();
    await refresh();
    return session;
  }

  Future<int> uploadPendingWebadminMutations() async {
    final uploaded = await webadminSync.uploadPendingMutations();
    await refresh();
    return uploaded;
  }

  Future<SyncResult> synchronizeWebadmin() async {
    final result = await webadminSync.synchronize();
    await refresh();
    return result;
  }

  Future<List<PendingSyncMutation>> webadminConflicts() =>
      webadminSync.pendingConflicts();

  Future<void> resolveWebadminConflict(
    PendingSyncMutation mutation, {
    required bool keepLocal,
  }) async {
    if (keepLocal) {
      await webadminSync.resolveConflictKeepLocal(mutation);
    } else {
      await webadminSync.resolveConflictUseServer(mutation);
    }
    await refresh();
  }

  Future<void> disconnectWebadmin() => webadminSync.disconnect();

  Future<void> _refreshNotes() async {
    notes = await repository.listNotes(
      search: search,
      notebookId: notebookFilter,
      categoryId: categoryFilter,
      tag: tagFilter,
      archivedOnly: archivedOnly,
    );
    notifyListeners();
  }
}
