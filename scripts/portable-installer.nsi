Unicode true
RequestExecutionLevel user

!include "MUI2.nsh"

!ifndef APP_EXE
  !error "APP_EXE must point to the built Career Lens executable"
!endif

!ifndef OUTPUT_EXE
  !error "OUTPUT_EXE must point to the installer output"
!endif

Name "Career Lens"
Caption "Career Lens Setup"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Career Lens"
SetCompressor /SOLID lzma
ShowInstDetails nevershow

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\career-lens.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Career Lens"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "Career Lens" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  Delete "$DESKTOP\Career Lens.lnk"
  File "/oname=career-lens.exe" "${APP_EXE}"
SectionEnd

Section /o "Create desktop shortcut" SEC_SHORTCUT
  CreateShortcut "$DESKTOP\Career Lens.lnk" "$INSTDIR\career-lens.exe"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "Install the Career Lens application."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_SHORTCUT} "Create a Career Lens shortcut on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END
