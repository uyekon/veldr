import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'local_database.dart';
import 'models.dart';
import 'sync_outbox.dart';

class NoteRepository {
  NoteRepository(this.localDatabase);

  final LocalDatabase localDatabase;
  static const _uuid = Uuid();
  late final SyncOutbox syncOutbox = SyncOutbox(localDatabase);

  Future<List<Notebook>> listNotebooks() async {
    final db = await localDatabase.database;
    final rows = await db.query(
      'notebooks',
      where: 'deleted_at IS NULL',
      orderBy: 'sort_order,label',
    );
    return rows.map(Notebook.fromMap).toList();
  }

  Future<Notebook> createNotebook(String label) async {
    final clean = label.trim();
    if (clean.isEmpty) throw ArgumentError('Notebook name is required');
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    final notebook = Notebook(id: _uuid.v7(), label: clean);
    await db.insert('notebooks', {
      'id': notebook.id,
      'label': notebook.label,
      'sort_order':
          Sqflite.firstIntValue(
            await db.rawQuery(
              'SELECT COALESCE(MAX(sort_order),-1)+1 FROM notebooks',
            ),
          ) ??
          0,
      'version': 1,
      'created_at': now,
      'updated_at': now,
    });
    return notebook;
  }

  Future<List<Category>> listCategories() async {
    final db = await localDatabase.database;
    final rows = await db.query(
      'categories',
      where: 'deleted_at IS NULL',
      orderBy: 'sort_order,label',
    );
    final links = await db.query('category_notebooks');
    return rows.map((row) {
      final id = row['id']! as String;
      return Category(
        id: id,
        label: row['label']! as String,
        parentId: row['parent_id'] as String?,
        notebookIds: links
            .where((link) => link['category_id'] == id)
            .map((link) => link['notebook_id']! as String)
            .toList(),
        sortOrder: row['sort_order']! as int,
        version: row['version']! as int,
      );
    }).toList();
  }

  Future<Category> createCategory({
    required String label,
    String? parentId,
    List<String> notebookIds = const [],
  }) async {
    final clean = label.trim();
    if (clean.isEmpty) throw ArgumentError('Category name is required');
    final db = await localDatabase.database;
    final category = Category(
      id: _uuid.v7(),
      label: clean,
      parentId: parentId,
      notebookIds: notebookIds,
    );
    final now = DateTime.now().toUtc().toIso8601String();
    await db.transaction((txn) async {
      if (parentId != null) {
        final parent = await txn.query(
          'categories',
          columns: ['id'],
          where: 'id=? AND deleted_at IS NULL',
          whereArgs: [parentId],
        );
        if (parent.isEmpty) throw ArgumentError('Parent category not found');
      }
      await txn.insert('categories', {
        'id': category.id,
        'label': clean,
        'parent_id': parentId,
        'sort_order': 0,
        'version': 1,
        'created_at': now,
        'updated_at': now,
      });
      for (final notebookId in notebookIds.toSet()) {
        await txn.insert('category_notebooks', {
          'category_id': category.id,
          'notebook_id': notebookId,
        });
      }
    });
    return category;
  }

  Future<List<String>> listTags() async {
    final db = await localDatabase.database;
    final rows = await db.rawQuery(
      '''SELECT t.name,COUNT(nt.note_id) count FROM tags t
      JOIN note_tags nt ON nt.tag_id=t.id JOIN notes n ON n.id=nt.note_id
      WHERE t.deleted_at IS NULL AND n.deleted_at IS NULL
      GROUP BY t.id ORDER BY count DESC,t.name''',
    );
    return rows.map((row) => row['name']! as String).toList();
  }

  Future<List<Note>> listNotes({
    String search = '',
    String? notebookId,
    String? categoryId,
    String? tag,
    bool archivedOnly = false,
  }) async {
    final db = await localDatabase.database;
    final clauses = <String>['n.deleted_at IS NULL'];
    final args = <Object?>[];
    clauses.add(
      archivedOnly ? 'n.archived_at IS NOT NULL' : 'n.archived_at IS NULL',
    );
    if (notebookId != null) {
      clauses.add('n.notebook_id=?');
      args.add(notebookId);
    }
    if (categoryId != null) {
      clauses.add('n.category_id=?');
      args.add(categoryId);
    }
    if (search.trim().isNotEmpty) {
      clauses.add(
        '(n.title LIKE ? OR n.content LIKE ? OR n.description LIKE ?)',
      );
      final term = '%${search.trim()}%';
      args.addAll([term, term, term]);
    }
    if (tag != null) {
      clauses.add(
        'EXISTS(SELECT 1 FROM note_tags x JOIN tags t ON t.id=x.tag_id '
        'WHERE x.note_id=n.id AND t.normalized_name=?)',
      );
      args.add(tag.trim().toLowerCase());
    }
    final rows = await db.query(
      'notes n',
      where: clauses.join(' AND '),
      whereArgs: args,
      orderBy: 'n.pinned DESC,n.updated_at DESC',
    );
    final result = <Note>[];
    for (final row in rows) {
      result.add(await _noteFromRow(db, row));
    }
    return result;
  }

  Future<Note?> getNote(String id) async {
    final db = await localDatabase.database;
    final rows = await db.query(
      'notes',
      where: 'id=? AND deleted_at IS NULL',
      whereArgs: [id],
      limit: 1,
    );
    return rows.isEmpty ? null : _noteFromRow(db, rows.first);
  }

  Future<Note> saveNote(
    Note note, {
    int? expectedVersion,
    Iterable<String> attachmentFilenames = const [],
  }) async {
    final db = await localDatabase.database;
    return db.transaction((txn) async {
      final current = await txn.query(
        'notes',
        where: 'id=?',
        whereArgs: [note.id],
        limit: 1,
      );
      if (current.isNotEmpty &&
          expectedVersion != null &&
          current.first['version'] != expectedVersion) {
        throw const VersionConflict('文章已在其他编辑会话中更新');
      }
      final now = DateTime.now().toUtc();
      final version = current.isEmpty
          ? 1
          : (current.first['version']! as int) + 1;
      final createdAt = current.isEmpty
          ? note.createdAt.toUtc()
          : DateTime.parse(current.first['created_at']! as String);
      final values = {
        'id': note.id,
        'notebook_id': note.notebookId,
        'category_id': note.categoryId,
        'title': note.title.trim().isEmpty ? '未命名笔记' : note.title.trim(),
        'content': note.content,
        'description': note.description,
        'pinned': note.pinned ? 1 : 0,
        'starred': note.starred ? 1 : 0,
        'archived_at': note.archivedAt?.toUtc().toIso8601String(),
        'version': version,
        'created_at': createdAt.toIso8601String(),
        'updated_at': now.toIso8601String(),
        'deleted_at': note.deletedAt?.toUtc().toIso8601String(),
      };
      if (current.isEmpty) {
        await txn.insert('notes', values);
      } else {
        final updateValues = Map<String, Object?>.from(values)..remove('id');
        await txn.update(
          'notes',
          updateValues,
          where: 'id=?',
          whereArgs: [note.id],
        );
      }
      await _replaceTags(txn, note.id, note.tags);
      for (final filename in attachmentFilenames.toSet()) {
        await _attachFile(txn, note.id, filename, now.toIso8601String());
      }
      return (await _noteFromRow(txn, values));
    });
  }

  Future<Note> setArchived(Note note, bool archived) async {
    final tags = note.tags
        .where((value) => value.toLowerCase() != 'archived')
        .toList();
    if (archived) tags.add('archived');
    return saveNote(
      note.copyWith(
        tags: tags,
        archivedAt: archived ? DateTime.now().toUtc() : null,
        clearArchivedAt: !archived,
      ),
      expectedVersion: note.version,
    );
  }

  Future<void> softDelete(Note note) async {
    final db = await localDatabase.database;
    final changed = await db.update(
      'notes',
      {
        'deleted_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
        'version': note.version + 1,
      },
      where: 'id=? AND version=? AND deleted_at IS NULL',
      whereArgs: [note.id, note.version],
    );
    if (changed != 1) throw const VersionConflict('删除前文章已经变化');
  }

  Future<List<Whiteboard>> listWhiteboards() async {
    final db = await localDatabase.database;
    final rows = await db.query(
      'whiteboards',
      where: 'deleted_at IS NULL',
      orderBy: "CASE legacy_key WHEN 'n' THEN 0 ELSE 1 END,updated_at DESC",
    );
    return rows.map(Whiteboard.fromMap).toList();
  }

  Future<Whiteboard?> getWhiteboard(String key) async {
    final db = await localDatabase.database;
    final rows = await db.query(
      'whiteboards',
      where: 'legacy_key=? AND deleted_at IS NULL',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : Whiteboard.fromMap(rows.first);
  }

  Future<Whiteboard> saveWhiteboard(
    String key,
    String content,
    int expectedVersion,
  ) async {
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    final changed = await db.update(
      'whiteboards',
      {'content': content, 'version': expectedVersion + 1, 'updated_at': now},
      where: 'legacy_key=? AND version=? AND deleted_at IS NULL',
      whereArgs: [key, expectedVersion],
    );
    if (changed != 1) throw const VersionConflict('白板内容已经变化，请重新载入');
    final row = (await db.query(
      'whiteboards',
      where: 'legacy_key=?',
      whereArgs: [key],
      limit: 1,
    )).first;
    return Whiteboard.fromMap(row);
  }

  /// Writes the authoritative server representation without incrementing the
  /// local version. This is used after a coalesced outbox upload succeeds.
  Future<void> applyRemoteNote(Map<String, Object?> item) async {
    final id = _requiredRemoteId(item, '文章');
    final db = await localDatabase.database;
    await db.transaction((txn) async {
      final current = await txn.query('notes', where: 'id=?', whereArgs: [id]);
      final now = DateTime.now().toUtc().toIso8601String();
      final values = <String, Object?>{
        'id': id,
        'notebook_id': _optionalId(item['notebookId']),
        'category_id': _optionalId(item['categoryId']),
        'title': _text(item['title'], '未命名笔记'),
        'content': _text(item['content'], ''),
        'description': _text(item['description'], ''),
        'pinned': _bool(item['pinned']) ? 1 : 0,
        'starred': _bool(item['starred']) ? 1 : 0,
        'archived_at': _optionalTimestamp(item['archivedAt']),
        'version': _integer(item['version'], 1),
        'created_at': _optionalTimestamp(item['createdAt']) ?? now,
        'updated_at': _optionalTimestamp(item['updatedAt']) ?? now,
        'deleted_at': null,
      };
      if (current.isEmpty) {
        await txn.insert('notes', values);
      } else {
        await txn.update(
          'notes',
          Map<String, Object?>.from(values)..remove('id'),
          where: 'id=?',
          whereArgs: [id],
        );
      }
      final tags = (item['tags'] as List? ?? const [])
          .map((value) => value.toString())
          .toList();
      await _replaceTags(txn, id, tags);
    });
  }

  Future<void> applyRemoteWhiteboard(Map<String, Object?> item) async {
    final id = _requiredRemoteId(item, '白板');
    final key = _text(item['legacyId'], '');
    if (key.isEmpty) throw const FormatException('白板缺少 legacyId');
    final titles = const {
      'n': '日记',
      't': '临时',
      'w': '工作',
      'dp': '每日推进',
      'ideas': '灵感',
    };
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    final values = <String, Object?>{
      'id': id,
      'legacy_key': key,
      'title': titles[key] ?? key,
      'content': _text(item['content'], ''),
      'version': _integer(item['version'], 1),
      'created_at': _optionalTimestamp(item['createdAt']) ?? now,
      'updated_at': _optionalTimestamp(item['updatedAt']) ?? now,
      'deleted_at': null,
    };
    final current = await db.query(
      'whiteboards',
      where: 'id=?',
      whereArgs: [id],
    );
    if (current.isEmpty) {
      await db.insert('whiteboards', values);
    } else {
      await db.update(
        'whiteboards',
        Map<String, Object?>.from(values)..remove('id'),
        where: 'id=?',
        whereArgs: [id],
      );
    }
  }

  /// Applies the v1 change-log contract in server sequence order. The caller
  /// advances its cursor only once each row has been committed locally.
  Future<void> applyRemoteChange(Map<String, Object?> change) async {
    final type = change['entityType']?.toString();
    final entityId = _optionalId(change['entityId']);
    final operation = change['operation']?.toString();
    final rawData = change['data'];
    final data = rawData is Map ? rawData.cast<String, Object?>() : null;
    if (type == null || entityId == null || operation == null) {
      throw const FormatException('同步增量缺少实体信息');
    }
    if (operation == 'delete') return _applyRemoteDelete(type, entityId);
    if (data == null) throw const FormatException('同步增量缺少实体内容');
    switch (type) {
      case 'note':
        return applyRemoteNote(data);
      case 'whiteboard':
        return applyRemoteWhiteboard(data);
      case 'navigationItem':
        return _applyRemoteNotebook(data);
      case 'category':
        return _applyRemoteCategory(data);
      default:
        // Media and attachment synchronization is intentionally deferred, but
        // their cursor rows can be consumed without changing local text data.
        return;
    }
  }

  Future<void> _applyRemoteNotebook(Map<String, Object?> item) async {
    final id = _requiredRemoteId(item, 'Notebook');
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    final values = <String, Object?>{
      'id': id,
      'label': _text(item['label'], '未命名 Notebook'),
      'sort_order': 0,
      'version': _integer(item['version'], 1),
      'created_at': _optionalTimestamp(item['createdAt']) ?? now,
      'updated_at': _optionalTimestamp(item['updatedAt']) ?? now,
      'deleted_at': null,
    };
    final current = await db.query('notebooks', where: 'id=?', whereArgs: [id]);
    if (current.isEmpty) {
      await db.insert('notebooks', values);
    } else {
      await db.update(
        'notebooks',
        Map<String, Object?>.from(values)..remove('id'),
        where: 'id=?',
        whereArgs: [id],
      );
    }
  }

  Future<void> _applyRemoteCategory(Map<String, Object?> item) async {
    final id = _requiredRemoteId(item, '分类');
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.transaction((txn) async {
      final values = <String, Object?>{
        'id': id,
        'label': _text(item['label'], '未命名分类'),
        'parent_id': _optionalId(item['parentId']),
        'sort_order': 0,
        'version': _integer(item['version'], 1),
        'created_at': _optionalTimestamp(item['createdAt']) ?? now,
        'updated_at': _optionalTimestamp(item['updatedAt']) ?? now,
        'deleted_at': null,
      };
      final current = await txn.query(
        'categories',
        where: 'id=?',
        whereArgs: [id],
      );
      if (current.isEmpty) {
        await txn.insert('categories', values);
      } else {
        await txn.update(
          'categories',
          Map<String, Object?>.from(values)..remove('id'),
          where: 'id=?',
          whereArgs: [id],
        );
      }
      await txn.delete(
        'category_notebooks',
        where: 'category_id=?',
        whereArgs: [id],
      );
      final notebookIds = item['notebookIds'];
      if (notebookIds is List) {
        for (final notebookId in notebookIds) {
          final value = _optionalId(notebookId);
          if (value != null) {
            await txn.insert('category_notebooks', {
              'category_id': id,
              'notebook_id': value,
            });
          }
        }
      }
    });
  }

  Future<void> _applyRemoteDelete(String type, String id) async {
    final db = await localDatabase.database;
    final table = switch (type) {
      'note' => 'notes',
      'whiteboard' => 'whiteboards',
      'navigationItem' => 'notebooks',
      'category' => 'categories',
      _ => null,
    };
    if (table == null) return;
    final now = DateTime.now().toUtc().toIso8601String();
    await db.update(
      table,
      {'deleted_at': now, 'updated_at': now},
      where: 'id=?',
      whereArgs: [id],
    );
  }

  Future<Note> convertDiary({
    required int expectedVersion,
    required String title,
    required String notebookId,
    String? categoryId,
    List<String> tags = const ['日记'],
  }) async {
    final db = await localDatabase.database;
    return db.transaction((txn) async {
      final rows = await txn.query(
        'whiteboards',
        where: "legacy_key='n' AND deleted_at IS NULL",
        limit: 1,
      );
      if (rows.isEmpty || rows.first['version'] != expectedVersion) {
        throw const VersionConflict('日记已被更新，未执行转换');
      }
      final content = (rows.first['content']! as String).trim();
      if (content.isEmpty) throw ArgumentError('日记内容为空');
      final now = DateTime.now().toUtc();
      final note = Note(
        id: _uuid.v7(),
        title: title.trim().isEmpty
            ? '日记 ${now.toLocal().toString().split(' ').first}'
            : title.trim(),
        content: content,
        notebookId: notebookId,
        categoryId: categoryId,
        tags: tags,
        createdAt: now,
        updatedAt: now,
      );
      await txn.insert('notes', _noteValues(note));
      await _replaceTags(txn, note.id, tags);
      final changed = await txn.update(
        'whiteboards',
        {
          'content': '',
          'version': expectedVersion + 1,
          'updated_at': now.toIso8601String(),
        },
        where: "legacy_key='n' AND version=?",
        whereArgs: [expectedVersion],
      );
      if (changed != 1) throw const VersionConflict('日记转换发生版本冲突');
      return note;
    });
  }

  Future<Map<String, Object?>> exportSnapshot() async {
    final db = await localDatabase.database;
    final tables = [
      'notebooks',
      'categories',
      'category_notebooks',
      'notes',
      'tags',
      'note_tags',
      'whiteboards',
      'attachments',
    ];
    final data = <String, Object?>{
      'format': 1,
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
    };
    for (final table in tables) {
      data[table] = await db.query(table);
    }
    return data;
  }

  Future<void> attachFileToNote(String noteId, String filename) async {
    final db = await localDatabase.database;
    final now = DateTime.now().toUtc().toIso8601String();
    await _attachFile(db, noteId, filename, now);
  }

  Future<void> _attachFile(
    DatabaseExecutor db,
    String noteId,
    String filename,
    String now,
  ) async {
    if (filename.isEmpty || filename.contains('/') || filename.contains('\\')) {
      throw const FormatException('Invalid attachment filename');
    }
    await db.insert('attachments', {
      'id': _uuid.v7(),
      'note_id': noteId,
      'relative_path': filename,
      'version': 1,
      'created_at': now,
      'updated_at': now,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<void> importSnapshot(Map<String, Object?> snapshot) async {
    if (snapshot['format'] != 1) throw const FormatException('不支持的备份格式');
    const tables = [
      'notebooks',
      'categories',
      'category_notebooks',
      'notes',
      'tags',
      'note_tags',
      'whiteboards',
      'attachments',
    ];
    for (final table in tables) {
      if (snapshot[table] is! List) {
        throw FormatException('备份缺少数据表：$table');
      }
    }
    final db = await localDatabase.database;
    await db.transaction((txn) async {
      await txn.execute('PRAGMA defer_foreign_keys = ON');
      for (final table in tables.reversed) {
        await txn.delete(table);
      }
      for (final table in tables) {
        for (final raw in snapshot[table]! as List) {
          if (raw is! Map) throw FormatException('$table 包含无效记录');
          await txn.insert(table, raw.cast<String, Object?>());
        }
      }
      // A restored/replaced library must never replay mutations that belonged
      // to its previous local state or a different remote account.
      await txn.delete('sync_mutations');
    });
  }

  /// Converts the stable v1 Webadmin bootstrap contract into the local-first
  /// SQLite snapshot. The server remains the explicit source of truth for the
  /// first connection; callers must obtain user confirmation before invoking
  /// this destructive replacement.
  Future<void> replaceWithWebadminBootstrap(
    Map<String, Object?> bootstrap,
  ) async {
    final entities = bootstrap['entities'];
    if (entities is! Map) throw const FormatException('Webadmin 同步数据无效');
    final records = entities.cast<String, Object?>();
    List<Map<String, Object?>> list(String key) {
      final raw = records[key];
      if (raw is! List) throw FormatException('Webadmin 同步缺少 $key');
      return raw.map((item) {
        if (item is! Map) throw FormatException('$key 包含无效记录');
        return item.cast<String, Object?>();
      }).toList();
    }

    final now = DateTime.now().toUtc().toIso8601String();
    final remoteNotebooks = list('notebooks');
    final remoteCategories = list('categories');
    final remoteNotes = list('notes');
    final remoteWhiteboards = list('whiteboards');
    final notebooks = <Map<String, Object?>>[];
    for (var index = 0; index < remoteNotebooks.length; index += 1) {
      final item = remoteNotebooks[index];
      final id = _requiredId(item, 'notebooks');
      notebooks.add({
        'id': id,
        'label': _text(item['label'], '未命名 Notebook'),
        'sort_order': index,
        'version': _integer(item['version'], 1),
        'created_at': _timestamp(item['createdAt'], now),
        'updated_at': _timestamp(item['updatedAt'], now),
        'deleted_at': null,
      });
    }
    if (notebooks.isEmpty) {
      throw const FormatException('Webadmin 没有可同步的 Notebook');
    }

    final categories = <Map<String, Object?>>[];
    final categoryLinks = <Map<String, Object?>>[];
    for (var index = 0; index < remoteCategories.length; index += 1) {
      final item = remoteCategories[index];
      final id = _requiredId(item, 'categories');
      categories.add({
        'id': id,
        'label': _text(item['label'], '未命名分类'),
        'parent_id': _optionalId(item['parentId']),
        'sort_order': index,
        'version': _integer(item['version'], 1),
        'created_at': _timestamp(item['createdAt'], now),
        'updated_at': _timestamp(item['updatedAt'], now),
        'deleted_at': null,
      });
      final linked = item['notebookIds'];
      if (linked is List) {
        for (final notebookId in linked) {
          final value = _optionalId(notebookId);
          if (value != null) {
            categoryLinks.add({'category_id': id, 'notebook_id': value});
          }
        }
      }
    }

    final tags = <Map<String, Object?>>[];
    final tagIds = <String, String>{};
    final noteTags = <Map<String, Object?>>[];
    final notes = <Map<String, Object?>>[];
    for (final item in remoteNotes) {
      final id = _requiredId(item, 'notes');
      final archivedAt = _optionalTimestamp(item['archivedAt']);
      final noteTagNames = <String>{};
      final rawTags = item['tags'];
      if (rawTags is List) {
        for (final value in rawTags) {
          final name = value.toString().trim();
          if (name.isNotEmpty) noteTagNames.add(name);
        }
      }
      if (archivedAt != null) noteTagNames.add('archived');
      for (final name in noteTagNames) {
        final normalized = name.toLowerCase();
        final tagId = tagIds.putIfAbsent(normalized, () {
          final generated = _uuid.v7();
          tags.add({
            'id': generated,
            'name': name,
            'normalized_name': normalized,
            'version': 1,
            'created_at': now,
            'updated_at': now,
            'deleted_at': null,
          });
          return generated;
        });
        noteTags.add({'note_id': id, 'tag_id': tagId});
      }
      notes.add({
        'id': id,
        'notebook_id': _optionalId(item['notebookId']),
        'category_id': _optionalId(item['categoryId']),
        'title': _text(item['title'], '未命名笔记'),
        'content': _text(item['content'], ''),
        'description': _text(item['description'], ''),
        'pinned': _bool(item['pinned']) ? 1 : 0,
        'starred': _bool(item['starred']) ? 1 : 0,
        'archived_at': archivedAt,
        'version': _integer(item['version'], 1),
        'created_at': _timestamp(item['createdAt'], now),
        'updated_at': _timestamp(item['updatedAt'], now),
        'deleted_at': null,
      });
    }

    const boardTitles = {
      'n': '日记',
      't': '临时',
      'w': '工作',
      'dp': '每日推进',
      'ideas': '灵感',
    };
    final whiteboards = <Map<String, Object?>>[];
    final keys = <String>{};
    for (final item in remoteWhiteboards) {
      final key = _text(item['legacyId'], '');
      if (key.isEmpty || !keys.add(key)) continue;
      whiteboards.add({
        'id': _requiredId(item, 'whiteboards'),
        'legacy_key': key,
        'title': boardTitles[key] ?? key,
        'content': _text(item['content'], ''),
        'version': _integer(item['version'], 1),
        'created_at': _timestamp(item['createdAt'], now),
        'updated_at': _timestamp(item['updatedAt'], now),
        'deleted_at': null,
      });
    }
    for (final entry in boardTitles.entries) {
      if (keys.add(entry.key)) {
        whiteboards.add({
          'id': _uuid.v7(),
          'legacy_key': entry.key,
          'title': entry.value,
          'content': '',
          'version': 1,
          'created_at': now,
          'updated_at': now,
          'deleted_at': null,
        });
      }
    }
    await importSnapshot({
      'format': 1,
      'notebooks': notebooks,
      'categories': categories,
      'category_notebooks': categoryLinks,
      'notes': notes,
      'tags': tags,
      'note_tags': noteTags,
      'whiteboards': whiteboards,
      // Attachment binaries are imported by the dedicated attachment sync
      // phase; metadata without a local file is intentionally not recorded.
      'attachments': const <Map<String, Object?>>[],
    });
  }

  static String _requiredId(Map<String, Object?> item, String type) {
    final id = _optionalId(item['id']);
    if (id == null) throw FormatException('$type 缺少 UUID');
    return id;
  }

  static String? _optionalId(Object? value) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? null : text;
  }

  static String _text(Object? value, String fallback) =>
      value is String && value.isNotEmpty ? value : fallback;

  static bool _bool(Object? value) => value == true || value == 1;

  static int _integer(Object? value, int fallback) => switch (value) {
    int value => value,
    num value => value.toInt(),
    String value => int.tryParse(value) ?? fallback,
    _ => fallback,
  };

  static String _timestamp(Object? value, String fallback) =>
      _optionalTimestamp(value) ?? fallback;

  static String? _optionalTimestamp(Object? value) {
    final text = value?.toString().trim() ?? '';
    return DateTime.tryParse(text)?.toUtc().toIso8601String();
  }

  Future<Note> _noteFromRow(
    DatabaseExecutor db,
    Map<String, Object?> row,
  ) async {
    final tagRows = await db.rawQuery(
      '''SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id
      WHERE nt.note_id=? AND t.deleted_at IS NULL ORDER BY t.name''',
      [row['id']],
    );
    return Note(
      id: row['id']! as String,
      title: row['title']! as String,
      content: row['content']! as String,
      description: (row['description'] as String?) ?? '',
      notebookId: row['notebook_id'] as String?,
      categoryId: row['category_id'] as String?,
      tags: tagRows.map((item) => item['name']! as String).toList(),
      pinned: row['pinned'] == 1,
      starred: row['starred'] == 1,
      archivedAt: _date(row['archived_at']),
      deletedAt: _date(row['deleted_at']),
      version: row['version']! as int,
      createdAt: DateTime.parse(row['created_at']! as String),
      updatedAt: DateTime.parse(row['updated_at']! as String),
    );
  }

  static DateTime? _date(Object? value) =>
      value is String && value.isNotEmpty ? DateTime.parse(value) : null;

  static Map<String, Object?> _noteValues(Note note) => {
    'id': note.id,
    'notebook_id': note.notebookId,
    'category_id': note.categoryId,
    'title': note.title.trim().isEmpty ? '未命名笔记' : note.title.trim(),
    'content': note.content,
    'description': note.description,
    'pinned': note.pinned ? 1 : 0,
    'starred': note.starred ? 1 : 0,
    'archived_at': note.archivedAt?.toUtc().toIso8601String(),
    'version': note.version,
    'created_at': note.createdAt.toUtc().toIso8601String(),
    'updated_at': note.updatedAt.toUtc().toIso8601String(),
    'deleted_at': note.deletedAt?.toUtc().toIso8601String(),
  };

  static String _requiredRemoteId(Map<String, Object?> item, String name) {
    final id = _optionalId(item['id']);
    if (id == null) throw FormatException('$name缺少 ID');
    return id;
  }

  Future<void> _replaceTags(
    DatabaseExecutor db,
    String noteId,
    Iterable<String> values,
  ) async {
    await db.delete('note_tags', where: 'note_id=?', whereArgs: [noteId]);
    final now = DateTime.now().toUtc().toIso8601String();
    final unique = <String, String>{};
    for (final value in values) {
      final name = value.trim();
      if (name.isNotEmpty) unique[name.toLowerCase()] = name;
    }
    for (final entry in unique.entries) {
      final existing = await db.query(
        'tags',
        columns: ['id'],
        where: 'normalized_name=?',
        whereArgs: [entry.key],
        limit: 1,
      );
      final tagId = existing.isEmpty
          ? _uuid.v7()
          : existing.first['id']! as String;
      if (existing.isEmpty) {
        await db.insert('tags', {
          'id': tagId,
          'name': entry.value,
          'normalized_name': entry.key,
          'version': 1,
          'created_at': now,
          'updated_at': now,
        });
      }
      await db.insert('note_tags', {'note_id': noteId, 'tag_id': tagId});
    }
  }
}
