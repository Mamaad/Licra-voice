$ErrorActionPreference = "Stop"
$setup = (Get-ChildItem client/src-tauri/target/release/bundle/nsis/*-setup.exe | Select-Object -First 1).FullName
$defaultDir = Join-Path $env:LOCALAPPDATA "Licra"
$data = Join-Path $env:APPDATA "org.licra.voice"
$mappedDrive = $null
$drive = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne $env:SystemDrive.TrimEnd(':') } | Select-Object -First 1
if (!$drive) {
  $mappedDrive = @('Z','Y','X') | Where-Object { !(Test-Path "${_}:\") } | Select-Object -First 1
  if (!$mappedDrive) { throw "No secondary drive available for installer verification" }
  & subst "${mappedDrive}:" $env:RUNNER_TEMP
  if ($LASTEXITCODE -ne 0) { throw "Could not create test drive" }
  $driveRoot = "${mappedDrive}:\"
} else { $driveRoot = $drive.Root }
$customDir = Join-Path $driveRoot ("Licra test dossier " + [guid]::NewGuid().ToString('N'))
$sentinel = Join-Path $data ".install-smoke"
try {
  Start-Process -FilePath $setup -ArgumentList "/S" -Wait
  if (!(Test-Path (Join-Path $defaultDir "licra-client.exe"))) { throw "Default per-user installation missing" }
  New-Item -ItemType Directory -Force $data | Out-Null
  Set-Content -Path $sentinel -Value "preserve application data"
  Get-Process licra-client -ErrorAction SilentlyContinue | Stop-Process
  Start-Process -FilePath (Join-Path $defaultDir "uninstall.exe") -ArgumentList "/S" -Wait
  if (!(Test-Path $sentinel)) { throw "Uninstall erased identity/settings" }
  # NSIS requires /D to be last and unquoted, including paths containing spaces.
  Start-Process -FilePath $setup -ArgumentList "/S", "/D=$customDir" -Wait
  if (!(Test-Path (Join-Path $customDir "licra-client.exe"))) { throw "Installation ignored the selected secondary drive" }
  if (Test-Path (Join-Path $defaultDir "licra-client.exe")) { throw "Installation fell back to C:" }
  if (!(Test-Path $sentinel)) { throw "Relocation erased application data" }
  # The same /UPDATE path used by the app must retain the registered directory.
  Start-Process -FilePath $setup -ArgumentList "/S", "/UPDATE" -Wait
  if (!(Test-Path (Join-Path $customDir "licra-client.exe"))) { throw "Update ignored the custom installation directory" }
  if (Test-Path (Join-Path $defaultDir "licra-client.exe")) { throw "Update fell back to C:" }
  if (!(Test-Path $sentinel)) { throw "Update erased application data" }
  Get-Process licra-client -ErrorAction SilentlyContinue | Stop-Process
  Start-Process -FilePath (Join-Path $customDir "uninstall.exe") -ArgumentList "/S" -Wait
  if (!(Test-Path $sentinel)) { throw "Silent uninstall erased identity/settings" }
  Write-Output "Default install, secondary drive with spaces, update path and AppData retention PASS"
} finally {
  Remove-Item $sentinel -ErrorAction SilentlyContinue
  if (Test-Path $customDir) { Remove-Item -Recurse -Force $customDir }
  if ($mappedDrive) { & subst "${mappedDrive}:" /D }
}
