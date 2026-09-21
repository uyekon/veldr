import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_state.dart';
import 'core/theme.dart';
import 'data/local_database.dart';
import 'data/note_repository.dart';
import 'ui/app_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final repository = NoteRepository(LocalDatabase());
  final state = AppState(repository);
  runApp(NoteFlowApp(state: state));
  await state.initialize();
}

class NoteFlowApp extends StatelessWidget {
  const NoteFlowApp({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider.value(
    value: state,
    child: MaterialApp(
      title: 'NoteFlow',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const AppShell(),
    ),
  );
}
