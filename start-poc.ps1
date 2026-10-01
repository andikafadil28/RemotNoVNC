$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$serverPath = Join-Path $root 'server'
$appPath = Join-Path $root 'app'

function Test-ListeningPort([int]$Port) {
  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm tidak ditemukan. Instal Node.js terlebih dahulu.'
}

if (-not (Test-Path -LiteralPath (Join-Path $serverPath 'data\users.json'))) {
  $env:ADMIN_USERNAME = Read-Host 'Username admin awal'
  $securePassword = Read-Host 'Password admin awal (minimal 10 karakter)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

if (Test-ListeningPort 3000) {
  'Backend sudah aktif: http://127.0.0.1:3000'
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev' -WorkingDirectory $serverPath
  'Backend dimulai pada http://127.0.0.1:3000'
}

Remove-Item Env:ADMIN_USERNAME -ErrorAction SilentlyContinue
Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue

if (Test-ListeningPort 5173) {
  'Dashboard sudah aktif: http://localhost:5173'
} else {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev' -WorkingDirectory $appPath
  'Dashboard dimulai pada http://localhost:5173'
}
