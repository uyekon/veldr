import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';

class PageFrame extends StatelessWidget {
  const PageFrame({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 760),
      child: child,
    ),
  );
}

class PageHeader extends StatelessWidget {
  const PageHeader(this.title, {super.key, this.subtitle, this.trailing});
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 22, 20, 14),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.headlineLarge),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle!,
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: AppColors.secondary),
                ),
              ],
            ],
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle({super.key, required this.label, this.icon});
  final String label;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(22, 22, 22, 10),
    child: Row(
      children: [
        if (icon != null) ...[
          Icon(icon, size: 18, color: AppColors.forest),
          const SizedBox(width: 7),
        ],
        Text(label, style: Theme.of(context).textTheme.titleMedium),
      ],
    ),
  );
}

class TagChip extends StatelessWidget {
  const TagChip(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: AppColors.mint,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      style: const TextStyle(color: AppColors.forestDark, fontSize: 12),
    ),
  );
}

class MetaPill extends StatelessWidget {
  const MetaPill({super.key, required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: const Color(0xFFF1F2EE),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [Icon(icon, size: 15), const SizedBox(width: 5), Text(label)],
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 54, color: AppColors.secondary),
        const SizedBox(height: 12),
        Text(text, style: const TextStyle(color: AppColors.secondary)),
      ],
    ),
  );
}

class ErrorCard extends StatelessWidget {
  const ErrorCard({super.key, required this.error, required this.onRetry});
  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(20),
    child: Card(
      child: ListTile(
        leading: const Icon(Icons.error_outline, color: Colors.red),
        title: const Text('加载失败'),
        subtitle: Text('$error'),
        trailing: IconButton(
          icon: const Icon(Icons.refresh),
          onPressed: onRetry,
        ),
      ),
    ),
  );
}

class MarkdownToolbar extends StatelessWidget {
  const MarkdownToolbar({super.key, required this.controller, this.onImage});
  final TextEditingController controller;
  final VoidCallback? onImage;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 48,
    child: ListView(
      scrollDirection: Axis.horizontal,
      children: [
        _tool(Icons.format_bold, '**', '**'),
        _tool(Icons.format_italic, '*', '*'),
        _tool(Icons.title, '## ', ''),
        _tool(Icons.format_list_bulleted, '- ', ''),
        _tool(Icons.check_box_outlined, '- [ ] ', ''),
        _tool(Icons.link, '[', '](url)'),
        if (onImage != null)
          IconButton.filledTonal(
            onPressed: onImage,
            icon: const Icon(Icons.image_outlined),
          ),
        _tool(Icons.code, '`', '`'),
      ],
    ),
  );

  Widget _tool(IconData icon, String before, String after) =>
      IconButton.filledTonal(
        onPressed: () => _surround(before, after),
        icon: Icon(icon),
      );

  void _surround(String before, String after) {
    final selection = controller.selection;
    final start = selection.isValid ? selection.start : controller.text.length;
    final end = selection.isValid ? selection.end : controller.text.length;
    final selected = controller.text.substring(start, end);
    controller.value = TextEditingValue(
      text:
          '${controller.text.substring(0, start)}$before$selected$after${controller.text.substring(end)}',
      selection: TextSelection.collapsed(
        offset: start + before.length + selected.length,
      ),
    );
  }
}

String excerpt(String markdown) => markdown
    .replaceAll(RegExp(r'[#*_>`\[\]()-]'), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

String relativeTime(DateTime value) {
  final delta = DateTime.now().difference(value.toLocal());
  if (delta.inMinutes < 1) return '刚刚';
  if (delta.inHours < 1) return '${delta.inMinutes} 分钟前';
  if (delta.inDays < 1) return '${delta.inHours} 小时前';
  if (delta.inDays < 7) return '${delta.inDays} 天前';
  return DateFormat('M月d日').format(value.toLocal());
}

ValueChanged<String> debounce(Future<void> Function(String) callback) {
  Timer? timer;
  return (value) {
    timer?.cancel();
    timer = Timer(const Duration(milliseconds: 300), () => callback(value));
  };
}

void showError(BuildContext context, Object error) =>
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('$error')));

Future<String?> textPrompt(BuildContext context, String title, String label) {
  var value = '';
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        autofocus: true,
        decoration: InputDecoration(labelText: label),
        onChanged: (next) => value = next,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(
            context,
            value.trim().isEmpty ? null : value.trim(),
          ),
          child: const Text('创建'),
        ),
      ],
    ),
  );
}
