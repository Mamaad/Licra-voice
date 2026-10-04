!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ${IfNot} ${Silent}
      StrCpy $DeleteAppDataCheckboxState 0
      MessageBox MB_YESNO|MB_ICONQUESTION "Conserver mon identité et mes paramètres Licra ?" IDYES keep_identity
      RMDir /r "$LOCALAPPDATA\org.licra.voice"
      RMDir /r "$APPDATA\org.licra.voice"
      keep_identity:
    ${EndIf}
  ${EndIf}
!macroend
