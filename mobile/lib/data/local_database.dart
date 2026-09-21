import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

class LocalDatabase {
  LocalDatabase({DatabaseFactory? factory, String? path})
    : _factory = factory ?? databaseFactory,
      _explicitPath = path;

  static const schemaVersion = 4;
  final DatabaseFactory _factory;
  final String? _explicitPath;
  Database? _database;

  Future<Database> get database async => _database ??= await _open();

  Future<Database> _open() async {
    final path =
        _explicitPath ??
        p.join(
          (await getApplicationSupportDirectory()).path,
          'noteflow.sqlite',
        );
    return _factory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: schemaVersion,
        onConfigure: (db) async => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: _createSchema,
        onUpgrade: _upgradeSchema,
      ),
    );
  }

  Future<void> _createSchema(Database db, int version) async {
    await db.transaction((txn) async {
      await txn.execute('''CREATE TABLE notebooks(
        id TEXT PRIMARY KEY,label TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        deleted_at TEXT)''');
      await txn.execute('''CREATE TABLE categories(
        id TEXT PRIMARY KEY,label TEXT NOT NULL,parent_id TEXT REFERENCES categories(id),
        sort_order INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)''');
      await txn.execute('''CREATE TABLE category_notebooks(
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        PRIMARY KEY(category_id,notebook_id))''');
      await txn.execute('''CREATE TABLE notes(
        id TEXT PRIMARY KEY,notebook_id TEXT REFERENCES notebooks(id),
        category_id TEXT REFERENCES categories(id),title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0,
        starred INTEGER NOT NULL DEFAULT 0,archived_at TEXT,version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)''');
      await txn.execute('''CREATE TABLE tags(
        id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized_name TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        deleted_at TEXT)''');
      await txn.execute('''CREATE TABLE note_tags(
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(note_id,tag_id))''');
      await txn.execute('''CREATE TABLE whiteboards(
        id TEXT PRIMARY KEY,legacy_key TEXT NOT NULL UNIQUE,title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT)''');
      await txn.execute('''CREATE TABLE attachments(
        id TEXT PRIMARY KEY,note_id TEXT REFERENCES notes(id),whiteboard_id TEXT REFERENCES whiteboards(id),
        relative_path TEXT NOT NULL UNIQUE,mime TEXT,size_bytes INTEGER,sha256 TEXT,
        version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        deleted_at TEXT)''');
      await txn.execute(
        'CREATE INDEX notes_updated_idx ON notes(updated_at DESC) WHERE deleted_at IS NULL',
      );
      await txn.execute(
        'CREATE INDEX notes_archived_idx ON notes(archived_at) WHERE deleted_at IS NULL',
      );
      await _createSyncSchema(txn);
      await _seed(txn);
    });
  }

  Future<void> _upgradeSchema(
    Database db,
    int oldVersion,
    int newVersion,
  ) async {
    if (oldVersion < 2) {
      await _createSyncSchema(db);
      return;
    }
    if (oldVersion < 3) {
      await db.execute(
        'ALTER TABLE sync_mutations ADD COLUMN sequence INTEGER',
      );
      await db.execute(
        'UPDATE sync_mutations SET sequence=rowid WHERE sequence IS NULL',
      );
      await db.execute(
        'CREATE INDEX IF NOT EXISTS sync_mutations_sequence_idx '
        'ON sync_mutations(target,sequence)',
      );
    }
    if (oldVersion < 4) {
      await db.execute(
        'ALTER TABLE sync_mutations ADD COLUMN base_payload TEXT',
      );
      await db.execute(
        'ALTER TABLE sync_mutations ADD COLUMN server_payload TEXT',
      );
    }
  }

  /// A device-local durable queue. It deliberately contains no credentials and
  /// is not part of user backups: it is only safe to replay for the currently
  /// connected remote library.
  Future<void> _createSyncSchema(DatabaseExecutor db) async {
    await db.execute('''CREATE TABLE IF NOT EXISTS sync_mutations(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      target TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, operation TEXT NOT NULL, base_version INTEGER,
      payload TEXT NOT NULL, created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      base_payload TEXT, server_payload TEXT,
      UNIQUE(target,entity_type,entity_id))''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS sync_mutations_sequence_idx '
      'ON sync_mutations(target,sequence)',
    );
  }

  Future<void> _seed(Transaction txn) async {
    const uuid = Uuid();
    final now = DateTime.now().toUtc().toIso8601String();
    final personalId = uuid.v7();
    await txn.insert('notebooks', {
      'id': personalId,
      'label': '个人笔记本',
      'sort_order': 0,
      'created_at': now,
      'updated_at': now,
    });
    for (final entry in const [
      ('n', '日记'),
      ('t', '临时'),
      ('w', '工作'),
      ('dp', '每日推进'),
      ('ideas', '灵感'),
    ]) {
      await txn.insert('whiteboards', {
        'id': uuid.v7(),
        'legacy_key': entry.$1,
        'title': entry.$2,
        'content': '',
        'created_at': now,
        'updated_at': now,
      });
    }
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}
