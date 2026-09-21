import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

class AttachmentService {
  AttachmentService({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;
  static const _uuid = Uuid();

  Future<Directory> rootDirectory() async {
    final support = await getApplicationSupportDirectory();
    final directory = Directory(p.join(support.path, 'attachments'));
    await directory.create(recursive: true);
    return directory;
  }

  Future<String?> pickImage() async {
    final selected = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 92,
    );
    if (selected == null) return null;
    final extension = p.extension(selected.name).toLowerCase();
    final safeExtension = RegExp(r'^\.[a-z0-9]{1,8}$').hasMatch(extension)
        ? extension
        : '.jpg';
    final filename = '${_uuid.v7()}$safeExtension';
    final root = await rootDirectory();
    await selected.saveTo(p.join(root.path, filename));
    return filename;
  }

  Future<File> resolve(String filename) async {
    if (p.basename(filename) != filename) {
      throw const FormatException('Invalid attachment path');
    }
    return File(p.join((await rootDirectory()).path, filename));
  }

  Future<void> delete(String filename) async {
    final file = await resolve(filename);
    if (await file.exists()) await file.delete();
  }
}
