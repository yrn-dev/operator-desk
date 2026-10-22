; Keep electron-builder's tested replacement/uninstall logic. This page makes
; the detected upgrade explicit and pins it to the existing installation.
!ifndef BUILD_UNINSTALLER
!include WordFunc.nsh
!include nsDialogs.nsh

Var OperatorInstalledVersion
Var OperatorInstalledDirectory
Var OperatorVersionComparison

!macro customHeader
  LangString OperatorInstall 1033 "Install"
  LangString OperatorInstall 1049 "Установить"
  LangString OperatorUpdate 1033 "Update"
  LangString OperatorUpdate 1049 "Обновить"
  LangString OperatorReinstall 1033 "Reinstall"
  LangString OperatorReinstall 1049 "Переустановить"
  LangString OperatorReady 1033 "Operator ${VERSION}"
  LangString OperatorReady 1049 "Operator ${VERSION}"
  LangString OperatorFresh 1033 "Install Operator on this computer."
  LangString OperatorFresh 1049 "Установка Operator на этот компьютер."
  LangString OperatorUpgrade 1033 "Installed: $OperatorInstalledVersion  ->  New: ${VERSION}"
  LangString OperatorUpgrade 1049 "Установлена: $OperatorInstalledVersion  ->  Новая: ${VERSION}"
  LangString OperatorKeepData 1033 "Your conversations, keys, settings and plugins will be preserved. Close Operator before continuing."
  LangString OperatorKeepData 1049 "Диалоги, ключи, настройки и плагины сохранятся. Перед продолжением закройте Operator."
  LangString OperatorDestination 1033 "Application folder:"
  LangString OperatorDestination 1049 "Папка приложения:"
  LangString OperatorNewerInstalled 1033 "Operator $OperatorInstalledVersion is already installed. This installer contains ${VERSION}. Download the current version to avoid a downgrade."
  LangString OperatorNewerInstalled 1049 "Уже установлен Operator $OperatorInstalledVersion. Этот установщик содержит ${VERSION}. Скачайте актуальную версию, чтобы не устанавливать более старую."
  !ifndef BUILD_UNINSTALLER
  Function OperatorDetectInstall
    StrCpy $OperatorInstalledVersion ""
    StrCpy $OperatorInstalledDirectory ""
    ReadRegStr $0 SHCTX "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
      ReadRegStr $OperatorInstalledVersion SHCTX "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      ${If} $OperatorInstalledVersion != ""
        StrCpy $OperatorInstalledDirectory $0
        StrCpy $INSTDIR $0
        ${VersionCompare} $OperatorInstalledVersion "${VERSION}" $OperatorVersionComparison
      ${EndIf}
    ${EndIf}
  FunctionEnd
  Function OperatorCheckVersion
    ${If} $OperatorInstalledVersion != ""
    ${AndIf} $OperatorVersionComparison == "1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(OperatorNewerInstalled)" /SD IDOK
      SetErrorLevel 1638
      Quit
    ${EndIf}
  FunctionEnd
  Function OperatorInstFilesPre
    Call OperatorDetectInstall
    Call OperatorCheckVersion
    ${If} $OperatorInstalledDirectory == ""
      Call instFilesPre
    ${EndIf}
  FunctionEnd
  Function OperatorConfirmShow
    Call OperatorDetectInstall
    Call OperatorCheckVersion
    !insertmacro MUI_HEADER_TEXT "$(OperatorReady)" "$(OperatorFresh)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${If} $OperatorInstalledVersion != ""
      !insertmacro MUI_HEADER_TEXT "$(OperatorReady)" "$(OperatorUpgrade)"
      ${NSD_CreateLabel} 0 8u 100% 32u "$(OperatorKeepData)"
      Pop $0
      GetDlgItem $0 $HWNDPARENT 1
      ${If} $OperatorVersionComparison == "0"
        SendMessage $0 ${WM_SETTEXT} 0 "STR:$(OperatorReinstall)"
      ${Else}
        SendMessage $0 ${WM_SETTEXT} 0 "STR:$(OperatorUpdate)"
      ${EndIf}
    ${Else}
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(OperatorInstall)"
    ${EndIf}
    ${NSD_CreateLabel} 0 55u 100% 14u "$(OperatorDestination)"
    Pop $0
    ${NSD_CreateLabel} 0 73u 100% 40u "$INSTDIR"
    Pop $0
    nsDialogs::Show
  FunctionEnd
  !endif
!macroend

!ifndef BUILD_UNINSTALLER


  !macro customInit
    Call OperatorDetectInstall
    ${If} ${Silent}
      Call OperatorCheckVersion
    ${EndIf}
  !macroend

  ; With one existing installation, keep its scope instead of offering to
  ; create a second copy for another Windows user scope.
  !macro customInstallMode
    ${IfNot} ${isForAllUsers}
    ${AndIfNot} ${isForCurrentUser}
      ${If} $hasPerUserInstallation == "1"
      ${AndIf} $hasPerMachineInstallation == "0"
      ${AndIf} ${FileExists} "$perUserInstallationFolder\${APP_EXECUTABLE_FILENAME}"
        StrCpy $isForceCurrentInstall "1"
      ${ElseIf} $hasPerMachineInstallation == "1"
      ${AndIf} $hasPerUserInstallation == "0"
      ${AndIf} ${FileExists} "$perMachineInstallationFolder\${APP_EXECUTABLE_FILENAME}"
        StrCpy $isForceMachineInstall "1"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    ; Replace the default path sanitizer: an update must keep even a custom
    ; old folder that does not contain the application's name.
    !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !endif
    !define MUI_PAGE_CUSTOMFUNCTION_PRE OperatorInstFilesPre
    Page custom OperatorConfirmShow
  !macroend


!endif
!endif
