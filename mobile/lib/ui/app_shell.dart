import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app_state.dart';
import 'diary_screen.dart';
import 'library_screen.dart';
import 'notes_screen.dart';
import 'settings_screen.dart';
import 'whiteboards_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      body: SafeArea(
        child: state.loading && state.notebooks.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : IndexedStack(
                index: index,
                children: const [
                  NotesScreen(),
                  DiaryScreen(),
                  WhiteboardsScreen(),
                  LibraryScreen(),
                  SettingsScreen(),
                ],
              ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.article_outlined),
            selectedIcon: Icon(Icons.article),
            label: '笔记',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            selectedIcon: Icon(Icons.calendar_today),
            label: '日记',
          ),
          NavigationDestination(
            icon: Icon(Icons.developer_board_outlined),
            selectedIcon: Icon(Icons.developer_board),
            label: '白板',
          ),
          NavigationDestination(
            icon: Icon(Icons.storage_outlined),
            selectedIcon: Icon(Icons.storage),
            label: '资料库',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: '设置',
          ),
        ],
      ),
    );
  }
}
