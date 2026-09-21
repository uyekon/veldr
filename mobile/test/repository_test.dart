import 'package:flutter_test/flutter_test.dart';
import 'package:noteflow_mobile/data/local_database.dart';
import 'package:noteflow_mobile/data/models.dart';
import 'package:noteflow_mobile/data/note_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:uuid/uuid.dart';

void main() {
  sqfliteFfiInit();
  late LocalDatabase database;
  late NoteRepository repository;

  setUp(() {
    database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    repository = NoteRepository(database);
  });

  tearDown(() => database.close());

  test('initializes local notebooks and standard whiteboards', () async {
    final notebooks = await repository.listNotebooks();
    final boards = await repository.listWhiteboards();
    expect(notebooks.single.label, '个人笔记本');
    expect(
      boards.map((item) => item.key),
      containsAll(['n', 't', 'w', 'dp', 'ideas']),
    );
  });

  test('saves notes, tags and pinned ordering locally', () async {
    final notebook = (await repository.listNotebooks()).single;
    final now = DateTime.utc(2026, 9, 18);
    final first = Note(
      id: const Uuid().v7(),
      title: '普通文章',
      content: '正文',
      notebookId: notebook.id,
      tags: const ['生活'],
      createdAt: now,
      updatedAt: now,
    );
    final pinned = Note(
      id: const Uuid().v7(),
      title: '置顶文章',
      content: '关键内容',
      notebookId: notebook.id,
      tags: const ['方法', '生活'],
      pinned: true,
      createdAt: now,
      updatedAt: now,
    );
    await repository.saveNote(first);
    await repository.saveNote(pinned);

    final notes = await repository.listNotes();
    expect(notes.map((item) => item.title), ['置顶文章', '普通文章']);
    expect(await repository.listTags(), containsAll(['生活', '方法']));
    expect((await repository.listNotes(tag: '方法')).single.id, pinned.id);
  });

  test('archived notes are hidden unless explicitly requested', () async {
    final notebook = (await repository.listNotebooks()).single;
    final now = DateTime.now().toUtc();
    final saved = await repository.saveNote(
      Note(
        id: const Uuid().v7(),
        title: '待归档',
        content: '内容',
        notebookId: notebook.id,
        createdAt: now,
        updatedAt: now,
      ),
    );
    await repository.setArchived(saved, true);

    expect(await repository.listNotes(), isEmpty);
    final archived = await repository.listNotes(archivedOnly: true);
    expect(archived.single.title, '待归档');
    expect(archived.single.tags, contains('archived'));
  });

  test(
    'updating a note preserves attachments and can clear category',
    () async {
      final notebook = (await repository.listNotebooks()).single;
      final category = await repository.createCategory(
        label: '临时分类',
        notebookIds: [notebook.id],
      );
      final now = DateTime.now().toUtc();
      final saved = await repository.saveNote(
        Note(
          id: const Uuid().v7(),
          title: '有关联数据的文章',
          content: '初稿',
          notebookId: notebook.id,
          categoryId: category.id,
          createdAt: now,
          updatedAt: now,
        ),
      );
      await repository.attachFileToNote(saved.id, 'photo.jpg');

      final updated = await repository.saveNote(
        saved.copyWith(content: '修改后', clearCategoryId: true),
        expectedVersion: saved.version,
      );
      final snapshot = await repository.exportSnapshot();

      expect(updated.categoryId, isNull);
      expect(updated.content, '修改后');
      expect((snapshot['attachments']! as List), hasLength(1));
    },
  );

  test('diary conversion is atomic and rejects a stale version', () async {
    final notebook = (await repository.listNotebooks()).single;
    var diary = (await repository.listWhiteboards()).singleWhere(
      (item) => item.key == 'n',
    );
    diary = await repository.saveWhiteboard('n', '今天完成了重要事项。', diary.version);

    expect(
      () => repository.convertDiary(
        expectedVersion: diary.version - 1,
        title: '错误转换',
        notebookId: notebook.id,
      ),
      throwsA(isA<VersionConflict>()),
    );
    expect(await repository.listNotes(), isEmpty);
    expect(
      (await repository.listWhiteboards())
          .singleWhere((item) => item.key == 'n')
          .content,
      isNotEmpty,
    );

    final converted = await repository.convertDiary(
      expectedVersion: diary.version,
      title: '今日记录',
      notebookId: notebook.id,
      tags: const ['日记'],
    );
    expect(converted.title, '今日记录');
    expect((await repository.listNotes()).single.content, contains('重要事项'));
    expect(
      (await repository.listWhiteboards())
          .singleWhere((item) => item.key == 'n')
          .content,
      isEmpty,
    );
  });

  test('snapshot restores into an empty local database', () async {
    final notebook = (await repository.listNotebooks()).single;
    final now = DateTime.now().toUtc();
    await repository.saveNote(
      Note(
        id: const Uuid().v7(),
        title: '备份文章',
        content: '# 可恢复',
        notebookId: notebook.id,
        createdAt: now,
        updatedAt: now,
      ),
    );
    final snapshot = await repository.exportSnapshot();
    final targetDb = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final target = NoteRepository(targetDb);
    await target.listNotebooks();
    await target.importSnapshot(snapshot);
    expect((await target.listNotes()).single.title, '备份文章');
    await targetDb.close();
  });

  test('imports the existing Webadmin bootstrap using its UUIDs', () async {
    const uuid = Uuid();
    final notebookId = uuid.v7();
    final parentCategoryId = uuid.v7();
    final categoryId = uuid.v7();
    final noteId = uuid.v7();
    final diaryId = uuid.v7();
    final now = DateTime.utc(2026, 9, 21).toIso8601String();

    await repository.replaceWithWebadminBootstrap({
      'cursor': '42',
      'entities': {
        'notebooks': [
          {
            'id': notebookId,
            'legacyId': 'docs',
            'label': 'Docs',
            'version': 3,
            'createdAt': now,
            'updatedAt': now,
          },
        ],
        'categories': [
          {
            'id': parentCategoryId,
            'label': '生活',
            'notebookIds': [notebookId],
            'version': 1,
            'createdAt': now,
            'updatedAt': now,
          },
          {
            'id': categoryId,
            'label': '体态',
            'parentId': parentCategoryId,
            'notebookIds': [notebookId],
            'version': 2,
            'createdAt': now,
            'updatedAt': now,
          },
        ],
        'notes': [
          {
            'id': noteId,
            'title': '来自 Webadmin',
            'content': '完整正文',
            'description': '摘要',
            'notebookId': notebookId,
            'categoryId': categoryId,
            'tags': ['强身健体'],
            'pinned': true,
            'archivedAt': now,
            'version': 5,
            'createdAt': now,
            'updatedAt': now,
          },
        ],
        'whiteboards': [
          {
            'id': diaryId,
            'legacyId': 'n',
            'content': 'Web 日记',
            'version': 4,
            'createdAt': now,
            'updatedAt': now,
          },
        ],
        'media': const [],
        'attachments': const [],
      },
    });

    expect((await repository.listNotebooks()).single.id, notebookId);
    final categories = await repository.listCategories();
    expect(
      categories.singleWhere((item) => item.id == categoryId).parentId,
      parentCategoryId,
    );
    expect((await repository.listNotes()).isEmpty, isTrue);
    final archived = (await repository.listNotes(archivedOnly: true)).single;
    expect(archived.id, noteId);
    expect(archived.tags, containsAll(['强身健体', 'archived']));
    expect(
      (await repository.listWhiteboards())
          .singleWhere((item) => item.key == 'n')
          .content,
      'Web 日记',
    );
  });
}
