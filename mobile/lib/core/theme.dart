import 'package:flutter/material.dart';

abstract final class AppColors {
  static const canvas = Color(0xFFFAF9F5);
  static const surface = Color(0xFFFFFEFB);
  static const forest = Color(0xFF286149);
  static const forestDark = Color(0xFF173F34);
  static const mint = Color(0xFFE8F2EB);
  static const ink = Color(0xFF173A3E);
  static const secondary = Color(0xFF668085);
  static const outline = Color(0xFFDCE3DE);
  static const blueChip = Color(0xFFE8F0FA);
  static const sandChip = Color(0xFFF4EEE4);
}

ThemeData buildTheme() {
  final scheme =
      ColorScheme.fromSeed(
        seedColor: AppColors.forest,
        brightness: Brightness.light,
        surface: AppColors.surface,
      ).copyWith(
        primary: AppColors.forest,
        onPrimary: Colors.white,
        secondary: AppColors.forestDark,
        onSurface: AppColors.ink,
        outline: AppColors.outline,
        surfaceContainerLow: AppColors.canvas,
      );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.canvas,
    fontFamilyFallback: const ['PingFang SC', 'Noto Sans CJK SC', 'sans-serif'],
    textTheme: const TextTheme(
      headlineLarge: TextStyle(
        fontSize: 34,
        fontWeight: FontWeight.w700,
        height: 1.2,
      ),
      headlineMedium: TextStyle(
        fontSize: 27,
        fontWeight: FontWeight.w700,
        height: 1.25,
      ),
      titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
      titleMedium: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      bodyLarge: TextStyle(fontSize: 17, height: 1.65),
      bodyMedium: TextStyle(fontSize: 15, height: 1.5),
    ).apply(bodyColor: AppColors.ink, displayColor: AppColors.ink),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.outline),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFF2F2EE),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide.none,
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      height: 72,
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.mint,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
  );
}
