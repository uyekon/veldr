class Notebook {
  const Notebook({
    required this.id,
    required this.label,
    this.sortOrder = 0,
    this.version = 1,
  });

  final String id;
  final String label;
  final int sortOrder;
  final int version;

  factory Notebook.fromMap(Map<String, Object?> map) => Notebook(
    id: map['id']! as String,
    label: map['label']! as String,
    sortOrder: map['sort_order']! as int,
    version: map['version']! as int,
  );
}

class Category {
  const Category({
    required this.id,
    required this.label,
    this.parentId,
    this.notebookIds = const [],
    this.sortOrder = 0,
    this.version = 1,
  });

  final String id;
  final String label;
  final String? parentId;
  final List<String> notebookIds;
  final int sortOrder;
  final int version;
}

class Note {
  const Note({
    required this.id,
    required this.title,
    required this.content,
    required this.createdAt,
    required this.updatedAt,
    this.notebookId,
    this.categoryId,
    this.description = '',
    this.tags = const [],
    this.pinned = false,
    this.starred = false,
    this.archivedAt,
    this.deletedAt,
    this.version = 1,
  });

  final String id;
  final String title;
  final String content;
  final String description;
  final String? notebookId;
  final String? categoryId;
  final List<String> tags;
  final bool pinned;
  final bool starred;
  final DateTime? archivedAt;
  final DateTime? deletedAt;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isArchived => archivedAt != null;

  Note copyWith({
    String? id,
    String? title,
    String? content,
    String? description,
    String? notebookId,
    String? categoryId,
    bool clearNotebookId = false,
    bool clearCategoryId = false,
    List<String>? tags,
    bool? pinned,
    bool? starred,
    DateTime? archivedAt,
    bool clearArchivedAt = false,
    DateTime? deletedAt,
    int? version,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => Note(
    id: id ?? this.id,
    title: title ?? this.title,
    content: content ?? this.content,
    description: description ?? this.description,
    notebookId: clearNotebookId ? null : notebookId ?? this.notebookId,
    categoryId: clearCategoryId ? null : categoryId ?? this.categoryId,
    tags: tags ?? this.tags,
    pinned: pinned ?? this.pinned,
    starred: starred ?? this.starred,
    archivedAt: clearArchivedAt ? null : archivedAt ?? this.archivedAt,
    deletedAt: deletedAt ?? this.deletedAt,
    version: version ?? this.version,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
}

class Whiteboard {
  const Whiteboard({
    required this.id,
    required this.key,
    required this.title,
    required this.content,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String key;
  final String title;
  final String content;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory Whiteboard.fromMap(Map<String, Object?> map) => Whiteboard(
    id: map['id']! as String,
    key: map['legacy_key']! as String,
    title: map['title']! as String,
    content: map['content']! as String,
    version: map['version']! as int,
    createdAt: DateTime.parse(map['created_at']! as String),
    updatedAt: DateTime.parse(map['updated_at']! as String),
  );
}

class VersionConflict implements Exception {
  const VersionConflict(this.message);
  final String message;
  @override
  String toString() => message;
}
