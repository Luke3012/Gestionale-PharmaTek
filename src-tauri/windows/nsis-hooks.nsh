Var PT_DESKTOP_SHORTCUT_PREEXISTED

!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$DESKTOP\Gestionale PharmaTek.lnk" 0 +3
    StrCpy $PT_DESKTOP_SHORTCUT_PREEXISTED "1"
    Goto +2
  StrCpy $PT_DESKTOP_SHORTCUT_PREEXISTED "0"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCmp $PT_DESKTOP_SHORTCUT_PREEXISTED "1" +2 0
    Delete "$DESKTOP\Gestionale PharmaTek.lnk"
!macroend
