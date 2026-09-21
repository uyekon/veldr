import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:noteflow_mobile/app_state.dart';
import 'package:noteflow_mobile/data/local_database.dart';
import 'package:noteflow_mobile/data/note_repository.dart';
import 'package:noteflow_mobile/main.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  sqfliteFfiInit();

  testWidgets('captures the implemented mobile notes screen', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final state = AppState(NoteRepository(database));
    await tester.runAsync(state.initialize);
    await tester.pumpWidget(NoteFlowApp(state: state));
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/implemented-notes.png'),
    );
    await tester.runAsync(database.close);
  });
}
