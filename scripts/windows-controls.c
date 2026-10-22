/* Test helper: inspect/click only the visible Operator installer in an isolated Wine prefix. */
#include <windows.h>
#include <stdio.h>
#include <string.h>
static HWND target;
static BOOL CALLBACK find_window(HWND wnd, LPARAM unused) {
  WCHAR title[1024], klass[128]; char title_utf8[4096];
  GetWindowTextW(wnd, title, 1024); GetClassNameW(wnd, klass, 128);
  WideCharToMultiByte(CP_UTF8, 0, title, -1, title_utf8, sizeof(title_utf8), NULL, NULL);
  if (IsWindowVisible(wnd) && lstrcmpW(klass, L"#32770") == 0 && strstr(title_utf8, "Operator")) { target = wnd; return FALSE; }
  return TRUE;
}
static void print_control(HWND wnd) {
  WCHAR text[4096]; char utf8[16384];
  GetWindowTextW(wnd, text, 4096);
  WideCharToMultiByte(CP_UTF8, 0, text, -1, utf8, sizeof(utf8), NULL, NULL);
  if (*utf8 && IsWindowVisible(wnd)) printf("%d\t%s\n", GetDlgCtrlID(wnd), utf8);
}
static BOOL CALLBACK child(HWND wnd, LPARAM unused) { print_control(wnd); return TRUE; }
int main(int argc, char **argv) {
  EnumWindows(find_window, 0);
  if (!target) return 2;
  if (argc > 1 && strcmp(argv[1], "next") == 0) {
    HWND next = GetDlgItem(target, 1);
    if (!next || !IsWindowEnabled(next)) return 3;
    PostMessageW(next, BM_CLICK, 0, 0);
  } else { print_control(target); EnumChildWindows(target, child, 0); }
  return 0;
}
