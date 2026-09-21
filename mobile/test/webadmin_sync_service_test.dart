import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:noteflow_mobile/data/local_database.dart';
import 'package:noteflow_mobile/data/models.dart';
import 'package:noteflow_mobile/data/note_repository.dart';
import 'package:noteflow_mobile/data/webadmin_sync_service.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:uuid/uuid.dart';

class _MemoryCredentials implements SyncCredentialStore {
  SyncSession? value;

  @override
  Future<void> clear() async => value = null;

  @override
  Future<SyncSession?> read() async => value;

  @override
  Future<void> write(SyncSession next) async => value = next;
}

void main() {
  sqfliteFfiInit();

  test(
    'signs in as Webadmin and imports its bootstrap into the local app',
    () async {
      final notebookId = const Uuid().v7();
      final noteId = const Uuid().v7();
      final boardId = const Uuid().v7();
      final now = DateTime.utc(2026, 9, 21).toIso8601String();
      final client = MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          expect(
            jsonDecode(request.body),
            containsPair('client', 'noteflow-mobile'),
          );
          return http.Response(
            jsonEncode({'role': 'admin', 'accessToken': 'session-token'}),
            200,
          );
        }
        if (request.url.path == '/api/v1/cms/sync/bootstrap') {
          expect(request.headers['authorization'], 'Bearer session-token');
          return http.Response.bytes(
            utf8.encode(
              jsonEncode({
                'cursor': '19',
                'entities': {
                  'notebooks': [
                    {
                      'id': notebookId,
                      'label': '现有资料',
                      'version': 1,
                      'createdAt': now,
                      'updatedAt': now,
                    },
                  ],
                  'categories': const [],
                  'notes': [
                    {
                      'id': noteId,
                      'title': 'Webadmin 文章',
                      'content': '同步正文',
                      'notebookId': notebookId,
                      'tags': ['同步'],
                      'version': 1,
                      'createdAt': now,
                      'updatedAt': now,
                    },
                  ],
                  'whiteboards': [
                    {
                      'id': boardId,
                      'legacyId': 'n',
                      'content': '服务器日记',
                      'version': 1,
                      'createdAt': now,
                      'updatedAt': now,
                    },
                  ],
                  'media': const [],
                  'attachments': const [],
                },
              }),
            ),
            200,
            headers: const {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('not found', 404);
      });
      final database = LocalDatabase(
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final repository = NoteRepository(database);
      final credentials = _MemoryCredentials();
      final sync = WebadminBootstrapSync(
        repository,
        client: CmsSyncClient(client: client),
        credentials: credentials,
      );

      final session = await sync.connectAndReplace(
        serverBaseUrl: 'https://cms.example.test',
        username: 'admin',
        password: 'correct-password',
      );

      expect(session.cursor, '19');
      expect((await repository.listNotes()).single.id, noteId);
      expect(
        (await repository.listWhiteboards())
            .singleWhere((board) => board.key == 'n')
            .content,
        '服务器日记',
      );
      expect((await credentials.read())?.accessToken, 'session-token');
      await database.close();
    },
  );

  test(
    'queues only connected local writes and coalesces repeated note saves',
    () async {
      final database = LocalDatabase(
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final repository = NoteRepository(database);
      final credentials = _MemoryCredentials();
      final sync = WebadminBootstrapSync(repository, credentials: credentials);
      final notebook = (await repository.listNotebooks()).single;
      final note = Note(
        id: const Uuid().v7(),
        title: '本地草稿',
        content: '第一版',
        notebookId: notebook.id,
        createdAt: DateTime.utc(2026, 9, 21),
        updatedAt: DateTime.utc(2026, 9, 21),
      );

      // Default local-first use does not create remote work.
      await sync.recordNoteSave(note);
      expect(await sync.pendingLocalMutations(), 0);

      await credentials.write(
        const SyncSession(
          serverBaseUrl: 'https://cms.example.test',
          accessToken: 'session-token',
          cursor: '1',
        ),
      );
      await sync.recordNoteSave(note);
      await sync.recordNoteSave(
        note.copyWith(content: '第二版'),
        previousVersion: 1,
      );
      final pending = await repository.syncOutbox.pending();

      expect(pending, hasLength(1));
      expect(pending.single.operation, 'create');
      expect(pending.single.baseVersion, isNull);
      expect(pending.single.payload['content'], '第二版');
      await database.close();
    },
  );

  test(
    'stages an offline library in dependency order only for an empty remote',
    () async {
      final database = LocalDatabase(
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
      );
      final repository = NoteRepository(database);
      final credentials = _MemoryCredentials()
        ..value = const SyncSession(
          serverBaseUrl: 'https://cms.example.test',
          accessToken: 'session-token',
          cursor: '0',
        );
      final sync = WebadminBootstrapSync(repository, credentials: credentials);
      final notebook = (await repository.listNotebooks()).single;
      final parent = await repository.createCategory(
        label: '父分类',
        notebookIds: [notebook.id],
      );
      final child = await repository.createCategory(
        label: '子分类',
        parentId: parent.id,
        notebookIds: [notebook.id],
      );
      await repository.saveNote(
        Note(
          id: const Uuid().v7(),
          title: '离线积累',
          content: '应在分类之后入队',
          notebookId: notebook.id,
          categoryId: child.id,
          tags: const ['本地'],
          createdAt: DateTime.utc(2026, 9, 21),
          updatedAt: DateTime.utc(2026, 9, 21),
        ),
      );

      expect(
        () => sync.queueLocalLibraryForFirstUpload(
          confirmedEmptyRemoteLibrary: false,
        ),
        throwsA(isA<SyncException>()),
      );
      final plan = await sync.queueLocalLibraryForFirstUpload(
        confirmedEmptyRemoteLibrary: true,
      );
      final pending = await repository.syncOutbox.pending();

      expect(plan.notebooks, 1);
      expect(plan.categories, 2);
      expect(plan.notes, 1);
      expect(plan.whiteboards, 5);
      expect(plan.attachmentsDeferred, 0);
      expect(pending.map((item) => item.entityType), [
        'notebook',
        'category',
        'category',
        'note',
        'whiteboard',
        'whiteboard',
        'whiteboard',
        'whiteboard',
        'whiteboard',
      ]);
      expect(pending[1].entityId, parent.id);
      expect(pending[2].entityId, child.id);
      await database.close();
    },
  );

  test('uploads a queued note once and applies the server version', () async {
    final database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final repository = NoteRepository(database);
    final notebook = (await repository.listNotebooks()).single;
    final note = await repository.saveNote(
      Note(
        id: const Uuid().v7(),
        title: '待上传',
        content: '本机版本',
        notebookId: notebook.id,
        createdAt: DateTime.utc(2026, 9, 21),
        updatedAt: DateTime.utc(2026, 9, 21),
      ),
    );
    final credentials = _MemoryCredentials()
      ..value = const SyncSession(
        serverBaseUrl: 'https://cms.example.test',
        accessToken: 'session-token',
        cursor: '0',
      );
    final client = MockClient((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/v1/cms/notes');
      final payload = jsonDecode(request.body) as Map<String, dynamic>;
      expect(payload['id'], note.id);
      expect(payload['mutationId'], isNotEmpty);
      return http.Response.bytes(
        utf8.encode(
          jsonEncode({
            'id': note.id,
            'title': note.title,
            'content': note.content,
            'description': '',
            'notebookId': notebook.id,
            'tags': const [],
            'version': 1,
            'createdAt': DateTime.utc(2026, 9, 21).toIso8601String(),
            'updatedAt': DateTime.utc(2026, 9, 21, 1).toIso8601String(),
          }),
        ),
        201,
      );
    });
    final sync = WebadminBootstrapSync(
      repository,
      client: CmsSyncClient(client: client),
      credentials: credentials,
    );
    await sync.recordNoteSave(note);

    expect(await sync.uploadPendingMutations(), 1);
    expect(await sync.pendingLocalMutations(), 0);
    expect(
      (await repository.getNote(note.id))!.updatedAt,
      DateTime.utc(2026, 9, 21, 1),
    );
    await database.close();
  });

  test('merges cursor changes without replacing the local library', () async {
    final database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final repository = NoteRepository(database);
    final notebook = (await repository.listNotebooks()).single;
    final noteId = const Uuid().v7();
    final credentials = _MemoryCredentials()
      ..value = const SyncSession(
        serverBaseUrl: 'https://cms.example.test',
        accessToken: 'session-token',
        cursor: '8',
      );
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/v1/cms/sync/changes');
      expect(request.url.queryParameters['cursor'], '8');
      return http.Response.bytes(
        utf8.encode(
          jsonEncode({
            'changes': [
              {
                'sequence': '9',
                'entityType': 'note',
                'entityId': noteId,
                'operation': 'upsert',
                'data': {
                  'id': noteId,
                  'title': '来自服务器的增量',
                  'content': '正文',
                  'notebookId': notebook.id,
                  'tags': ['同步'],
                  'version': 1,
                  'createdAt': DateTime.utc(2026, 9, 21).toIso8601String(),
                  'updatedAt': DateTime.utc(2026, 9, 21).toIso8601String(),
                },
              },
            ],
            'nextCursor': '9',
            'hasMore': false,
          }),
        ),
        200,
      );
    });
    final sync = WebadminBootstrapSync(
      repository,
      client: CmsSyncClient(client: client),
      credentials: credentials,
    );

    final result = await sync.synchronize();

    expect(result.downloaded, 1);
    expect(result.session.cursor, '9');
    expect((await repository.getNote(noteId))!.title, '来自服务器的增量');
    await database.close();
  });
}
