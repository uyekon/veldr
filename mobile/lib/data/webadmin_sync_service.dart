import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'note_repository.dart';
import 'models.dart';
import 'sync_outbox.dart';

class SyncSession {
  const SyncSession({
    required this.serverBaseUrl,
    required this.accessToken,
    required this.cursor,
    this.lastSyncedAt,
  });

  final String serverBaseUrl;
  final String accessToken;
  final String cursor;
  final DateTime? lastSyncedAt;
}

/// Result of preparing a formerly offline library for its first upload. Binary
/// attachments are intentionally counted but not queued until resumable media
/// transfer is implemented; the UI must show this before it enables upload.
class InitialLibraryUploadPlan {
  const InitialLibraryUploadPlan({
    required this.notebooks,
    required this.categories,
    required this.notes,
    required this.whiteboards,
    required this.attachmentsDeferred,
  });

  final int notebooks;
  final int categories;
  final int notes;
  final int whiteboards;
  final int attachmentsDeferred;

  int get queued => notebooks + categories + notes + whiteboards;
}

abstract class SyncCredentialStore {
  Future<SyncSession?> read();
  Future<void> write(SyncSession value);
  Future<void> clear();
}

class SecureSyncCredentialStore implements SyncCredentialStore {
  SecureSyncCredentialStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _server = 'webadmin.sync.server';
  static const _token = 'webadmin.sync.token';
  static const _cursor = 'webadmin.sync.cursor';
  static const _lastSynced = 'webadmin.sync.lastSynced';
  final FlutterSecureStorage _storage;

  @override
  Future<SyncSession?> read() async {
    final values = await _storage.readAll();
    final server = values[_server];
    final token = values[_token];
    if (server == null || token == null || server.isEmpty || token.isEmpty) {
      return null;
    }
    return SyncSession(
      serverBaseUrl: server,
      accessToken: token,
      cursor: values[_cursor] ?? '0',
      lastSyncedAt: DateTime.tryParse(values[_lastSynced] ?? ''),
    );
  }

  @override
  Future<void> write(SyncSession value) async {
    final timestamp = (value.lastSyncedAt ?? DateTime.now().toUtc())
        .toIso8601String();
    await _storage.write(key: _server, value: value.serverBaseUrl);
    await _storage.write(key: _token, value: value.accessToken);
    await _storage.write(key: _cursor, value: value.cursor);
    await _storage.write(key: _lastSynced, value: timestamp);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _server);
    await _storage.delete(key: _token);
    await _storage.delete(key: _cursor);
    await _storage.delete(key: _lastSynced);
  }
}

class CmsSyncClient {
  CmsSyncClient({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;

  Future<SyncSession> signIn({
    required String serverBaseUrl,
    required String username,
    required String password,
  }) async {
    final base = _normalizeBase(serverBaseUrl);
    final response = await _client.post(
      base.resolve('/api/auth/login'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({
        'username': username.trim(),
        'password': password,
        'client': 'noteflow-mobile',
      }),
    );
    final body = _body(response);
    if (response.statusCode != 200) {
      throw SyncException(body['error']?.toString() ?? '无法连接 Webadmin');
    }
    final token = body['accessToken']?.toString();
    if (token == null || token.isEmpty) {
      throw const SyncException('服务器未提供移动端授权，请更新后端后重试');
    }
    return SyncSession(
      serverBaseUrl: base.toString().replaceFirst(RegExp(r'/$'), ''),
      accessToken: token,
      cursor: '0',
    );
  }

  Future<Map<String, Object?>> bootstrap(SyncSession session) async {
    final base = _normalizeBase(session.serverBaseUrl);
    final response = await _client.get(
      base.resolve('/api/v1/cms/sync/bootstrap'),
      headers: {'authorization': 'Bearer ${session.accessToken}'},
    );
    final body = _body(response);
    if (response.statusCode != 200) {
      throw SyncException(body['error']?.toString() ?? '无法下载 Webadmin 数据');
    }
    if (body['entities'] is! Map || body['cursor'] == null) {
      throw const SyncException('服务器同步数据格式无效');
    }
    return body;
  }

  Future<Map<String, Object?>> changes(
    SyncSession session, {
    required String cursor,
  }) async {
    final base = _normalizeBase(session.serverBaseUrl);
    final response = await _client.get(
      base.resolve('/api/v1/cms/sync/changes?cursor=$cursor&limit=100'),
      headers: {'authorization': 'Bearer ${session.accessToken}'},
    );
    final body = _body(response);
    if (response.statusCode != 200 || body['changes'] is! List) {
      throw SyncException(body['error']?.toString() ?? '无法下载同步增量');
    }
    return body;
  }

  Future<Map<String, Object?>> sendMutation(
    SyncSession session,
    PendingSyncMutation mutation,
  ) async {
    final endpoint = switch ((mutation.entityType, mutation.operation)) {
      ('note', 'create') => '/api/v1/cms/notes',
      ('note', 'update') => '/api/v1/cms/notes/${mutation.entityId}',
      ('note', 'delete') => '/api/v1/cms/notes/${mutation.entityId}',
      ('notebook', 'create') => '/api/v1/cms/notebooks',
      ('category', 'create') => '/api/v1/cms/categories',
      ('whiteboard', 'create') => '/api/v1/cms/whiteboards',
      ('whiteboard', 'update') =>
        '/api/v1/cms/whiteboards/${mutation.entityId}',
      _ => throw SyncException(
        '暂不支持同步 ${mutation.entityType}/${mutation.operation}',
      ),
    };
    final body = <String, Object?>{
      ...mutation.payload,
      'mutationId': mutation.id,
      if (mutation.baseVersion != null) 'baseVersion': mutation.baseVersion,
    };
    final base = _normalizeBase(session.serverBaseUrl);
    final response = switch (mutation.operation) {
      'create' => await _client.post(
        base.resolve(endpoint),
        headers: _headers(session),
        body: jsonEncode(body),
      ),
      'update' => await _client.put(
        base.resolve(endpoint),
        headers: _headers(session),
        body: jsonEncode(body),
      ),
      'delete' => await _client.delete(
        base.resolve(endpoint),
        headers: _headers(session),
        body: jsonEncode(body),
      ),
      _ => throw StateError('unreachable'),
    };
    final decoded = _body(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw SyncRequestException(
        statusCode: response.statusCode,
        message: decoded['error']?.toString() ?? '同步请求失败',
        current: decoded['current'] is Map
            ? (decoded['current'] as Map).cast<String, Object?>()
            : null,
      );
    }
    return decoded;
  }

  Map<String, String> _headers(SyncSession session) => {
    'authorization': 'Bearer ${session.accessToken}',
    'content-type': 'application/json',
  };

  Uri _normalizeBase(String raw) {
    final normalized = raw.trim().replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.tryParse(normalized);
    if (uri == null ||
        !uri.hasScheme ||
        (uri.scheme != 'https' && uri.scheme != 'http')) {
      throw const SyncException('请输入有效的服务器地址');
    }
    return uri;
  }

  Map<String, Object?> _body(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic>
          ? decoded.cast<String, Object?>()
          : <String, Object?>{};
    } catch (_) {
      return <String, Object?>{};
    }
  }
}

/// Webadmin's first sync track remains source-to-device until mutation replay
/// lands. Local writes made after a connection are nevertheless journaled now
/// so no edit is lost while the upload/conflict UI is completed.
class WebadminBootstrapSync {
  WebadminBootstrapSync(
    this.repository, {
    CmsSyncClient? client,
    SyncCredentialStore? credentials,
  }) : _client = client ?? CmsSyncClient(),
       _credentials = credentials ?? SecureSyncCredentialStore();

  final NoteRepository repository;
  final CmsSyncClient _client;
  final SyncCredentialStore _credentials;

  Future<SyncSession?> currentSession() => _credentials.read();

  Future<SyncSession> connectAndReplace({
    required String serverBaseUrl,
    required String username,
    required String password,
  }) async {
    final session = await _client.signIn(
      serverBaseUrl: serverBaseUrl,
      username: username,
      password: password,
    );
    return _downloadAndReplace(session);
  }

  Future<SyncSession> refreshFromServer() async {
    final session = await _credentials.read();
    if (session == null) throw const SyncException('尚未连接现有 Webadmin');
    return _downloadAndReplace(session);
  }

  Future<void> disconnect() => _credentials.clear();

  Future<int> pendingLocalMutations() => repository.syncOutbox.count();

  /// Uploads in dependency order. A 409 deliberately leaves the failed item in
  /// place and stops the batch so the conflict UI can offer an explicit choice.
  Future<int> uploadPendingMutations() async {
    final session = await _credentials.read();
    if (session == null) throw const SyncException('尚未连接现有 Webadmin');
    var uploaded = 0;
    for (final mutation in await repository.syncOutbox.pending()) {
      try {
        final response = await _client.sendMutation(session, mutation);
        if (mutation.entityType == 'note' && mutation.operation != 'delete') {
          await repository.applyRemoteNote(response);
        }
        if (mutation.entityType == 'whiteboard' &&
            mutation.operation != 'delete') {
          await repository.applyRemoteWhiteboard(response);
        }
        await repository.syncOutbox.acknowledge(mutation.id);
        uploaded += 1;
      } on SyncRequestException catch (error) {
        await repository.syncOutbox.recordFailure(
          mutation.id,
          error.message,
          serverPayload: error.current,
        );
        rethrow;
      } catch (error) {
        await repository.syncOutbox.recordFailure(
          mutation.id,
          error.toString(),
        );
        rethrow;
      }
    }
    return uploaded;
  }

  /// Runs a safe foreground synchronization: push durable local operations,
  /// then merge every server change after the stored cursor. It never calls the
  /// destructive bootstrap replacement path.
  Future<SyncResult> synchronize() async {
    final session = await _credentials.read();
    if (session == null) throw const SyncException('尚未连接现有 Webadmin');
    final uploaded = await uploadPendingMutations();
    var cursor = session.cursor;
    var downloaded = 0;
    while (true) {
      final page = await _client.changes(session, cursor: cursor);
      final changes = page['changes']! as List;
      for (final raw in changes) {
        if (raw is! Map) throw const SyncException('服务器增量格式无效');
        await repository.applyRemoteChange(raw.cast<String, Object?>());
        downloaded += 1;
      }
      cursor = page['nextCursor']?.toString() ?? cursor;
      if (page['hasMore'] != true) break;
    }
    final updated = SyncSession(
      serverBaseUrl: session.serverBaseUrl,
      accessToken: session.accessToken,
      cursor: cursor,
      lastSyncedAt: DateTime.now().toUtc(),
    );
    await _credentials.write(updated);
    return SyncResult(
      uploaded: uploaded,
      downloaded: downloaded,
      session: updated,
    );
  }

  /// Stages all active local records for a first upload to a *verified empty*
  /// remote library. This does not contact the server and intentionally has no
  /// UI entry yet: an eventual VIP activation flow must first authenticate the
  /// user, inspect the selected library manifest, and ask for confirmation.
  Future<InitialLibraryUploadPlan> queueLocalLibraryForFirstUpload({
    required bool confirmedEmptyRemoteLibrary,
  }) async {
    if (await _credentials.read() == null) {
      throw const SyncException('请先连接并验证目标资料库');
    }
    if (!confirmedEmptyRemoteLibrary) {
      throw const SyncException('只有确认目标资料库为空时才能准备首次上传');
    }
    final snapshot = await repository.exportSnapshot();
    final notebooks = _active(snapshot, 'notebooks');
    final categories = _sortCategories(_active(snapshot, 'categories'));
    final notes = _active(snapshot, 'notes');
    final whiteboards = _active(snapshot, 'whiteboards');
    final tags = {
      for (final row in _active(snapshot, 'tags')) row['id']! as String: row,
    };
    final tagsByNote = <String, List<String>>{};
    for (final link in snapshot['note_tags']! as List) {
      if (link is! Map) continue;
      final values = link.cast<String, Object?>();
      final noteId = values['note_id'] as String?;
      final tag = tags[values['tag_id']];
      final name = tag?['name'] as String?;
      if (noteId != null && name != null) {
        (tagsByNote[noteId] ??= []).add(name);
      }
    }
    final notebooksByCategory = <String, List<String>>{};
    for (final link in snapshot['category_notebooks']! as List) {
      if (link is! Map) continue;
      final values = link.cast<String, Object?>();
      final categoryId = values['category_id'] as String?;
      final notebookId = values['notebook_id'] as String?;
      if (categoryId != null && notebookId != null) {
        (notebooksByCategory[categoryId] ??= []).add(notebookId);
      }
    }
    final drafts = <SyncMutationDraft>[
      for (final item in notebooks)
        SyncMutationDraft(
          entityType: 'notebook',
          entityId: item['id']! as String,
          operation: 'create',
          payload: {'id': item['id'], 'label': item['label']},
        ),
      for (final item in categories)
        SyncMutationDraft(
          entityType: 'category',
          entityId: item['id']! as String,
          operation: 'create',
          payload: {
            'id': item['id'],
            'label': item['label'],
            'parentId': item['parent_id'],
            'notebookIds': notebooksByCategory[item['id']] ?? const [],
          },
        ),
      for (final item in notes)
        SyncMutationDraft(
          entityType: 'note',
          entityId: item['id']! as String,
          operation: 'create',
          payload: {
            'id': item['id'],
            'title': item['title'],
            'content': item['content'],
            'description': item['description'],
            'notebookId': item['notebook_id'],
            'categoryId': item['category_id'],
            'tags': tagsByNote[item['id']] ?? const [],
            'pinned': item['pinned'] == 1,
            'starred': item['starred'] == 1,
            'archivedAt': item['archived_at'],
          },
        ),
      for (final item in whiteboards)
        SyncMutationDraft(
          entityType: 'whiteboard',
          entityId: item['id']! as String,
          operation: 'create',
          payload: {
            'id': item['id'],
            'legacyId': item['legacy_key'],
            'content': item['content'],
          },
        ),
    ];
    await repository.syncOutbox.replaceWithInitialUpload(drafts);
    return InitialLibraryUploadPlan(
      notebooks: notebooks.length,
      categories: categories.length,
      notes: notes.length,
      whiteboards: whiteboards.length,
      attachmentsDeferred: _active(snapshot, 'attachments').length,
    );
  }

  Future<List<PendingSyncMutation>> pendingConflicts() async =>
      (await repository.syncOutbox.pending())
          .where((mutation) => mutation.serverPayload != null)
          .toList();

  Future<void> resolveConflictUseServer(PendingSyncMutation mutation) async {
    final server = mutation.serverPayload;
    if (server == null) throw const SyncException('服务器冲突版本不可用');
    switch (mutation.entityType) {
      case 'note':
        await repository.applyRemoteNote(server);
        break;
      case 'whiteboard':
        await repository.applyRemoteWhiteboard(server);
        break;
      default:
        throw const SyncException('此类型暂不支持在 App 中解决冲突');
    }
    await repository.syncOutbox.acknowledge(mutation.id);
  }

  Future<void> resolveConflictKeepLocal(PendingSyncMutation mutation) =>
      repository.syncOutbox.rebaseWithServer(mutation);

  Future<void> recordNoteSave(
    Note note, {
    int? previousVersion,
    Note? baseNote,
  }) => _record(
    entityType: 'note',
    entityId: note.id,
    operation: previousVersion == null ? 'create' : 'update',
    baseVersion: previousVersion,
    payload: {
      'id': note.id,
      'title': note.title,
      'content': note.content,
      'description': note.description,
      'notebookId': note.notebookId,
      'categoryId': note.categoryId,
      'tags': note.tags,
      'pinned': note.pinned,
      'starred': note.starred,
      'archivedAt': note.archivedAt?.toUtc().toIso8601String(),
    },
    basePayload: baseNote == null
        ? null
        : {
            'id': baseNote.id,
            'title': baseNote.title,
            'content': baseNote.content,
            'description': baseNote.description,
            'notebookId': baseNote.notebookId,
            'categoryId': baseNote.categoryId,
            'tags': baseNote.tags,
            'pinned': baseNote.pinned,
            'starred': baseNote.starred,
            'archivedAt': baseNote.archivedAt?.toUtc().toIso8601String(),
          },
  );

  Future<void> recordNoteDelete(Note note) => _record(
    entityType: 'note',
    entityId: note.id,
    operation: 'delete',
    baseVersion: note.version,
    payload: {'id': note.id},
  );

  Future<void> recordWhiteboardSave(
    Whiteboard board, {
    required int previousVersion,
  }) => _record(
    entityType: 'whiteboard',
    entityId: board.id,
    operation: 'update',
    baseVersion: previousVersion,
    payload: {'id': board.id, 'legacyId': board.key, 'content': board.content},
  );

  Future<void> recordNotebookCreate(Notebook notebook) => _record(
    entityType: 'notebook',
    entityId: notebook.id,
    operation: 'create',
    payload: {'id': notebook.id, 'label': notebook.label},
  );

  Future<void> recordCategoryCreate(Category category) => _record(
    entityType: 'category',
    entityId: category.id,
    operation: 'create',
    payload: {
      'id': category.id,
      'label': category.label,
      'parentId': category.parentId,
      'notebookIds': category.notebookIds,
    },
  );

  Future<void> _record({
    required String entityType,
    required String entityId,
    required String operation,
    required Map<String, Object?> payload,
    int? baseVersion,
    Map<String, Object?>? basePayload,
  }) async {
    // Local-only users do not have a session and never create a queue or make
    // a network request. Queueing begins only after an explicit connection.
    if (await _credentials.read() == null) return;
    await repository.syncOutbox.enqueue(
      entityType: entityType,
      entityId: entityId,
      operation: operation,
      payload: payload,
      baseVersion: baseVersion,
      basePayload: basePayload,
      target: SyncOutbox.webadminTarget,
    );
  }

  static List<Map<String, Object?>> _active(
    Map<String, Object?> snapshot,
    String table,
  ) {
    final raw = snapshot[table];
    if (raw is! List) throw FormatException('本地资料库缺少 $table');
    return raw
        .whereType<Map>()
        .map((item) => item.cast<String, Object?>())
        .where((item) => item['deleted_at'] == null)
        .toList();
  }

  static List<Map<String, Object?>> _sortCategories(
    List<Map<String, Object?>> categories,
  ) {
    final byId = {for (final item in categories) item['id']! as String: item};
    final sorted = <Map<String, Object?>>[];
    final visited = <String>{};
    void visit(Map<String, Object?> item) {
      final id = item['id']! as String;
      if (!visited.add(id)) return;
      final parentId = item['parent_id'] as String?;
      final parent = parentId == null ? null : byId[parentId];
      if (parent != null) visit(parent);
      sorted.add(item);
    }

    for (final item in categories) {
      visit(item);
    }
    return sorted;
  }

  Future<SyncSession> _downloadAndReplace(SyncSession session) async {
    final bootstrap = await _client.bootstrap(session);
    await repository.replaceWithWebadminBootstrap(bootstrap);
    final updated = SyncSession(
      serverBaseUrl: session.serverBaseUrl,
      accessToken: session.accessToken,
      cursor: bootstrap['cursor']!.toString(),
      lastSyncedAt: DateTime.now().toUtc(),
    );
    await _credentials.write(updated);
    return updated;
  }
}

class SyncException implements Exception {
  const SyncException(this.message);
  final String message;

  @override
  String toString() => message;
}

class SyncResult {
  const SyncResult({
    required this.uploaded,
    required this.downloaded,
    required this.session,
  });

  final int uploaded;
  final int downloaded;
  final SyncSession session;
}

class SyncRequestException extends SyncException {
  const SyncRequestException({
    required this.statusCode,
    required String message,
    this.current,
  }) : super(message);

  final int statusCode;
  final Map<String, Object?>? current;

  bool get isVersionConflict => statusCode == 409;
}
