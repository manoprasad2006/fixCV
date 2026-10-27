# Offline smoke test: syntax-check + server routes that need no Meta API.
# Usage (from fixcv/): powershell -File scripts/smoke-local.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
node --check (Join-Path $root 'frontend/app.js')
node --check (Join-Path $root 'backend/server.js')
Write-Output 'syntax: ok'

$port = '3457'
$env:PORT = $port
$p = Start-Process -FilePath 'node' -ArgumentList 'backend/server.js' `
  -WorkingDirectory $root -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 2
  $s = Invoke-RestMethod "http://localhost:$port/session" -Method Post `
    -Body '{"language":"ta"}' -ContentType 'application/json'
  Write-Output ("session: lang={0} id_len={1}" -f $s.language, $s.id.Length)

  $d = Invoke-RestMethod "http://localhost:$port/diagnose" -Method Post `
    -Body (@{ sessionId = $s.id; transcript = 'gas leak in kitchen' } | ConvertTo-Json) `
    -ContentType 'application/json'
  Write-Output ("diagnose-unsafe: stopped={0} category={1} title={2}" -f $d.stopped, $d.category, $d.title)

  foreach ($ep in @('/segment', '/transcribe')) {
    try {
      Invoke-RestMethod "http://localhost:$port$ep" -Method Post -Body '{}' -ContentType 'application/json' | Out-Null
      Write-Output ($ep + ': UNEXPECTED 200')
    } catch {
      Write-Output ($ep + ': ' + [int]$_.Exception.Response.StatusCode)
    }
  }

  $page = Invoke-WebRequest "http://localhost:$port/" -UseBasicParsing
  Write-Output ("GET /: {0} len={1}" -f [int]$page.StatusCode, $page.RawContentLength)
  $loc = Invoke-RestMethod "http://localhost:$port/locales/hi.json"
  Write-Output ("GET /locales/hi.json: lang={0} reviewed={1}" -f $loc.lang, $loc.reviewed)
} finally {
  Stop-Process -Id $p.Id -Force
}
Write-Output 'smoke: done'
