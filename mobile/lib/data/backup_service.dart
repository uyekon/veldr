import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:archive/archive_io.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';

import 'models.dart';
import 'note_repository.dart';

class BackupService {
  const BackupService(this.repository);
  final NoteRepository repository;

  Future<File> createBackup() async {
    final snapshot = await repository.exportSnapshot();
    final bytes = utf8.encode(
      const JsonEncoder.withIndent('  ').convert(snapshot),
    );
    final archive = Archive()
      ..addFile(ArchiveFile('noteflow.json', bytes.length, bytes));
    final support = await getApplicationSupportDirectory();
    final attachmentRoot = Directory(p.join(support.path, 'attachments'));
    if (await attachmentRoot.exists()) {
      await for (final entity in attachmentRoot.list(followLinks: false)) {
        if (entity is! File) continue;
        final fileBytes = await entity.readAsBytes();
        archive.addFile(
          ArchiveFile(
            'attachments/${p.basename(entity.path)}',
            fileBytes.length,
            fileBytes,
          ),
        );
      }
    }
    final zip = ZipEncoder().encode(archive);
    final temp = await getTemporaryDirectory();
    final stamp = DateTime.now().toUtc().toIso8601String().replaceAll(':', '-');
    final file = File(p.join(temp.path, 'noteflow-$stamp.zip'));
    await file.writeAsBytes(zip, flush: true);
    return file;
  }

  Future<void> shareBackup() async {
    final file = await createBackup();
    await SharePlus.instance.share(
      ShareParams(
        title: 'NoteFlow 本地备份',
        text: 'NoteFlow 本地数据库备份',
        files: [XFile(file.path, mimeType: 'application/zip')],
      ),
    );
  }

  Future<void> shareMarkdownExport() async {
    final notes = [
      ...await repository.listNotes(),
      ...await repository.listNotes(archivedOnly: true),
    ];
    final archive = Archive();
    final usedNames = <String>{};
    for (final note in notes) {
      var filename = _safeFilename(note.title);
      var suffix = 2;
      while (!usedNames.add(filename)) {
        filename = '${_safeFilename(note.title)}-$suffix';
        suffix += 1;
      }
      final frontMatter = <String>[
        '---',
        'id: ${note.id}',
        if (note.tags.isNotEmpty) 'tags: ${note.tags.join(', ')}',
        'updated: ${note.updatedAt.toUtc().toIso8601String()}',
        '---',
        '',
        '# ${note.title}',
        '',
        note.content,
      ].join('\n');
      final bytes = utf8.encode(frontMatter);
      archive.addFile(ArchiveFile('$filename.md', bytes.length, bytes));
    }
    final zip = ZipEncoder().encode(archive);
    final temp = await getTemporaryDirectory();
    final stamp = DateTime.now().toUtc().toIso8601String().replaceAll(':', '-');
    final file = File(p.join(temp.path, 'noteflow-markdown-$stamp.zip'));
    await file.writeAsBytes(zip, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        title: 'NoteFlow Markdown 导出',
        text: '共导出 ${notes.length} 篇笔记',
        files: [XFile(file.path, mimeType: 'application/zip')],
      ),
    );
  }

  Future<int> pickAndImportMarkdown() async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['md', 'markdown', 'txt'],
    );
    if (picked.isEmpty) return 0;
    final notebooks = await repository.listNotebooks();
    final notebookId = notebooks.firstOrNull?.id;
    var imported = 0;
    for (final file in picked) {
      final raw = await file.xFile.readAsString();
      final parsed = _parseMarkdown(raw, p.basenameWithoutExtension(file.name));
      final now = DateTime.now().toUtc();
      await repository.saveNote(
        Note(
          id: const Uuid().v7(),
          title: parsed.$1,
          content: parsed.$2,
          notebookId: notebookId,
          createdAt: now,
          updatedAt: now,
        ),
      );
      imported += 1;
    }
    return imported;
  }

  Future<bool> pickAndRestore() async {
    final picked = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['zip'],
    );
    if (picked == null) return false;
    final bytes = await picked.xFile.readAsBytes();
    final archive = ZipDecoder().decodeBytes(bytes, verify: true);
    final entry = archive.findFile('noteflow.json');
    if (entry == null) throw const FormatException('不是 NoteFlow 备份');
    final decoded = jsonDecode(utf8.decode(entry.content as List<int>));
    if (decoded is! Map) throw const FormatException('备份内容无效');
    final support = await getApplicationSupportDirectory();
    final attachmentRoot = Directory(p.join(support.path, 'attachments'));
    final incoming = Directory(
      p.join(
        support.path,
        'attachments.restore-${DateTime.now().microsecondsSinceEpoch}',
      ),
    );
    await incoming.create(recursive: true);
    for (final file in archive.files.where(
      (item) => item.name.startsWith('attachments/'),
    )) {
      final filename = p.basename(file.name);
      if (file.name != 'attachments/$filename' || filename.isEmpty) {
        await incoming.delete(recursive: true);
        throw const FormatException('备份包含不安全的附件路径');
      }
      await File(p.join(incoming.path, filename))
          .writeAsBytes(file.content as List<int>);
    }
    Directory? previous;
    if (await attachmentRoot.exists()) {
      previous = await attachmentRoot.rename(
        '${attachmentRoot.path}.previous-${DateTime.now().microsecondsSinceEpoch}',
      );
    }
    await incoming.rename(attachmentRoot.path);
    try {
      await repository.importSnapshot(decoded.cast<String, Object?>());
      if (previous != null) await previous.delete(recursive: true);
    } catch (_) {
      if (await attachmentRoot.exists()) {
        await attachmentRoot.delete(recursive: true);
      }
      if (previous != null) await previous.rename(attachmentRoot.path);
      rethrow;
    }
    return true;
  }

  String _safeFilename(String value) {
    final cleaned = value
        .trim()
        .replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), '-')
        .replaceAll(RegExp(r'\s+'), ' ');
    return cleaned.isEmpty
        ? '未命名笔记'
        : cleaned.substring(0, cleaned.length.clamp(0, 80));
  }

  (String, String) _parseMarkdown(String raw, String fallbackTitle) {
    var body = raw.replaceFirst(RegExp(r'^---\s*\n[\s\S]*?\n---\s*\n'), '');
    final heading = RegExp(r'^#\s+(.+?)\s*$', multiLine: true).firstMatch(body);
    final title = heading?.group(1)?.trim();
    if (heading != null && heading.start == 0) {
      body = body.substring(heading.end).replaceFirst(RegExp(r'^\s+'), '');
    }
    return (title == null || title.isEmpty ? fallbackTitle : title, body);
  }
}
