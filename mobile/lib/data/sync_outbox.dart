import 'dart:convert';

import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'local_database.dart';

/// A queued local mutation. The same entity has at most one pending record;
/// repeated saves coalesce into its newest payload while retaining a stable
/// mutation id for a future idempotent HTTP retry.
class PendingSyncMutation {
  const PendingSyncMutation({
    required this.id,
    required this.target,
    required this.entityType,
    required this.entityId,
    required this.operation,
    required this.payload,
    required this.createdAt,
    this.baseVersion,
    this.attempts = 0,
    this.lastError,
    this.basePayload,
    this.serverPayload,
  });

  final String id;
  final String target;
  final String entityType;
  final String entityId;
  final String operation;
  final int? baseVersion;
  final Map<String, Object?> payload;
  final DateTime createdAt;
  final int attempts;
  final String? lastError;
  final Map<String, Object?>? basePayload;
  final Map<String, Object?>? serverPayload;

  factory PendingSyncMutation.fromMap(Map<String, Object?> map) {
    final decoded = jsonDecode(map['payload']! as String);
    if (decoded is! Map) throw const FormatException('同步队列内容无效');
    return PendingSyncMutation(
      id: map['id']! as String,
      target: map['target']! as String,
      entityType: map['entity_type']! as String,
      entityId: map['entity_id']! as String,
      operation: map['operation']! as String,
      baseVersion: map['base_version'] as int?,
      payload: decoded.cast<String, Object?>(),
      createdAt: DateTime.parse(map['created_at']! as String),
      attempts: map['attempts']! as int,
      lastError: map['last_error'] as String?,
      basePayload: _decodeOptional(map['base_payload']),
      serverPayload: _decodeOptional(map['server_payload']),
    );
  }

  static Map<String, Object?>? _decodeOptional(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    final value = jsonDecode(raw);
    return value is Map ? value.cast<String, Object?>() : null;
  }
}

/// An unpersisted item used to atomically seed an empty remote library. The
/// list order is preserved in SQLite's monotonic sequence field so dependencies
/// (Notebook -> category -> note) are uploaded safely later.
class SyncMutationDraft {
  const SyncMutationDraft({
    required this.entityType,
    required this.entityId,
    required this.operation,
    required this.payload,
    this.baseVersion,
  });

  final String entityType;
  final String entityId;
  final String operation;
  final Map<String, Object?> payload;
  final int? baseVersion;
}

class SyncOutbox {
  SyncOutbox(this._database);

  static const webadminTarget = 'webadmin-v1';
  static const _uuid = Uuid();
  final LocalDatabase _database;

  Future<void> enqueue({
    required String entityType,
    required String entityId,
    required String operation,
    required Map<String, Object?> payload,
    int? baseVersion,
    Map<String, Object?>? basePayload,
    String target = webadminTarget,
  }) async {
    final db = await _database.database;
    await db.transaction((txn) async {
      final existing = await txn.query(
        'sync_mutations',
        where: 'target=? AND entity_type=? AND entity_id=?',
        whereArgs: [target, entityType, entityId],
        limit: 1,
      );
      final now = DateTime.now().toUtc().toIso8601String();
      if (existing.isEmpty) {
        await txn.insert('sync_mutations', {
          'id': _uuid.v7(),
          'target': target,
          'entity_type': entityType,
          'entity_id': entityId,
          'operation': operation,
          'base_version': baseVersion,
          'payload': jsonEncode(payload),
          'created_at': now,
          'base_payload': basePayload == null ? null : jsonEncode(basePayload),
        });
        return;
      }
      // Do not turn an unsent create into an update: the server has never seen
      // this UUID. A delete after an unsent create cancels the mutation.
      if (operation == 'delete' && existing.first['operation'] == 'create') {
        await txn.delete(
          'sync_mutations',
          where: 'id=?',
          whereArgs: [existing.first['id']],
        );
        return;
      }
      final keepCreate = existing.first['operation'] == 'create';
      await txn.update(
        'sync_mutations',
        {
          'operation': keepCreate ? 'create' : operation,
          'base_version': keepCreate ? null : baseVersion,
          'payload': jsonEncode(payload),
          'attempts': 0,
          'last_error': null,
          'server_payload': null,
        },
        where: 'id=?',
        whereArgs: [existing.first['id']],
      );
    });
  }

  Future<List<PendingSyncMutation>> pending({
    String target = webadminTarget,
  }) async {
    final db = await _database.database;
    final rows = await db.query(
      'sync_mutations',
      where: 'target=?',
      whereArgs: [target],
      orderBy: 'sequence',
    );
    return rows.map(PendingSyncMutation.fromMap).toList();
  }

  Future<int> count({String target = webadminTarget}) async {
    final db = await _database.database;
    return Sqflite.firstIntValue(
          await db.rawQuery(
            'SELECT COUNT(*) FROM sync_mutations WHERE target=?',
            [target],
          ),
        ) ??
        0;
  }

  Future<void> clear({String target = webadminTarget}) async {
    final db = await _database.database;
    await db.delete('sync_mutations', where: 'target=?', whereArgs: [target]);
  }

  Future<void> acknowledge(String id) async {
    final db = await _database.database;
    await db.delete('sync_mutations', where: 'id=?', whereArgs: [id]);
  }

  Future<void> recordFailure(
    String id,
    String message, {
    Map<String, Object?>? serverPayload,
  }) async {
    final db = await _database.database;
    await db.rawUpdate(
      'UPDATE sync_mutations SET attempts=attempts+1,last_error=?,server_payload=? WHERE id=?',
      [message, serverPayload == null ? null : jsonEncode(serverPayload), id],
    );
  }

  Future<void> rebaseWithServer(PendingSyncMutation mutation) async {
    final server = mutation.serverPayload;
    final version = server?['version'];
    if (server == null || version is! num) {
      throw const FormatException('缺少可用于解决冲突的服务器版本');
    }
    final db = await _database.database;
    await db.update(
      'sync_mutations',
      {
        'id': _uuid.v7(),
        'base_version': version.toInt(),
        'base_payload': jsonEncode(server),
        'server_payload': null,
        'attempts': 0,
        'last_error': null,
      },
      where: 'id=?',
      whereArgs: [mutation.id],
    );
  }

  /// Replaces the queue in one transaction only after a user has selected an
  /// empty remote library. This makes a first upload resumable even if the app
  /// exits while preparing thousands of local records.
  Future<void> replaceWithInitialUpload(
    Iterable<SyncMutationDraft> drafts, {
    String target = webadminTarget,
  }) async {
    final db = await _database.database;
    await db.transaction((txn) async {
      await txn.delete(
        'sync_mutations',
        where: 'target=?',
        whereArgs: [target],
      );
      final now = DateTime.now().toUtc().toIso8601String();
      for (final draft in drafts) {
        await txn.insert('sync_mutations', {
          'id': _uuid.v7(),
          'target': target,
          'entity_type': draft.entityType,
          'entity_id': draft.entityId,
          'operation': draft.operation,
          'base_version': draft.baseVersion,
          'payload': jsonEncode(draft.payload),
          'created_at': now,
        });
      }
    });
  }
}
