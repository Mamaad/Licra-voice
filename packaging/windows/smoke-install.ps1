$ErrorActionPreference = "Stop"
$setup = (Get-ChildItem client/src-tauri/target/release/bundle/nsis/*-setup.exe | Select-Object -First 1).FullName
$app = Join-Path $env:LOCALAPPDATA "Licra/licra-client.exe"
$data = Join-Path $env:APPDATA "org.licra.voice"
Start-Process -FilePath $setup -ArgumentList "/S" -Wait
if (!(Test-Path $app)) { throw "Per-user install missing from LocalAppData" }
New-Item -ItemType Directory -Force $data | Out-Null
$sentinel = Join-Path $data ".install-smoke"
Set-Content -Path $sentinel -Value "preserve application data"
Start-Process -FilePath $setup -ArgumentList "/S", "/UPDATE" -Wait
if (!(Test-Path $sentinel)) { throw "Update erased application data" }
Get-Process licra-client -ErrorAction SilentlyContinue | Stop-Process
Start-Process -FilePath (Join-Path $env:LOCALAPPDATA "Licra/uninstall.exe") -ArgumentList "/S" -Wait
if (!(Test-Path $sentinel)) { throw "Silent uninstall erased identity/settings directory" }
Remove-Item $sentinel
Write-Output "Per-user install, update and data retention PASS"
