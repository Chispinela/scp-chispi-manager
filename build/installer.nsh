!include "WinVer.nsh"

# This include is parsed before MUI defines its LANG_* constants.
LangString ChispiWindowsRequired 3082 "SCP Chispi Manager requiere Windows 10 o Windows 11 de 64 bits (Intel/AMD)."
LangString ChispiWindowsRequired 1033 "SCP Chispi Manager requires 64-bit Windows 10 or Windows 11 (Intel/AMD)."
LangString ChispiWindowsRequired 1049 "Для SCP Chispi Manager требуется 64-разрядная Windows 10 или Windows 11 (Intel/AMD)."
LangString ChispiWindowsRequired 2052 "SCP Chispi Manager 需要 64 位 Windows 10 或 Windows 11 (Intel/AMD)。"
LangString ChispiWindowsRequired 1041 "SCP Chispi Manager には 64 ビット版 Windows 10 または Windows 11 (Intel/AMD) が必要です。"
LangString ChispiWindowsRequired 2070 "O SCP Chispi Manager requer Windows 10 ou Windows 11 de 64 bits (Intel/AMD)."

!macro customInit
  # Windows 11 shares version 10.0 with Windows 10. Accept all builds and
  # editions from Windows 10 onward; do not add a Windows 11 build ceiling.
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(ChispiWindowsRequired)"
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
