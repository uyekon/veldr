import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:noteflow_mobile/app_state.dart';
import 'package:noteflow_mobile/data/local_database.dart';
import 'package:noteflow_mobile/data/note_repository.dart';
import 'package:noteflow_mobile/data/webadmin_sync_service.dart';
import 'package:noteflow_mobile/main.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  sqfliteFfiInit();

  testWidgets('opens the offline app with five primary destinations', (
    tester,
  ) async {
    final database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final state = AppState(NoteRepository(database));
    await tester.runAsync(state.initialize);
    await tester.pumpWidget(NoteFlowApp(state: state));
    await tester.pump();

    expect(find.text('笔记'), findsWidgets);
    expect(find.text('日记'), findsOneWidget);
    expect(find.text('白板'), findsOneWidget);
    expect(find.text('资料库'), findsOneWidget);
    expect(find.text('设置'), findsOneWidget);
    expect(find.text('还没有笔记，写下第一条吧'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.runAsync(database.close);
  });

  testWidgets('opens the existing Webadmin import entry from settings', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 900));
    final database = LocalDatabase(
      factory: databaseFactoryFfi,
      path: inMemoryDatabasePath,
    );
    final repository = NoteRepository(database);
    final sync = WebadminBootstrapSync(
      repository,
      credentials: _EmptyCredentials(),
    );
    final state = AppState(repository, webadminSync: sync);
    await tester.runAsync(state.initialize);
    await tester.pumpWidget(NoteFlowApp(state: state));
    await tester.pumpAndSettle();

    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('现有 Webadmin 同步'));
    await tester.pumpAndSettle();

    expect(find.text('现有 Webadmin 同步'), findsOneWidget);
    expect(find.text('连接现有 Webadmin'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.runAsync(database.close);
    await tester.binding.setSurfaceSize(null);
  });
}

class _EmptyCredentials implements SyncCredentialStore {
  @override
  Future<void> clear() async {}

  @override
  Future<SyncSession?> read() async => null;

  @override
  Future<void> write(SyncSession value) async {}
}
