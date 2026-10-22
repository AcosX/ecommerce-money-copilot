# Usage: pwsh -File tools/github-pr.ps1 -Number 63
# Update an existing PR body: add -BodyFile docs/pr-body.md
[CmdletBinding()]
param(
    [int]$Number = 0,
    [string]$BodyFile = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:GH_PROMPT_DISABLED = '1'
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
}
$userNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'User')
if ($userNoProxy) {
    $env:NO_PROXY = ((@($env:NO_PROXY -split ',') + @($userNoProxy -split ',')) |
        Where-Object { $_ } | Select-Object -Unique) -join ','
}

$bodyPath = if ($BodyFile) { (Resolve-Path -LiteralPath $BodyFile).Path } else { $null }
$temporaryBody = $null
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $prArgs = @()
    if ($Number -gt 0) { $prArgs += [string]$Number }
    if ($bodyPath) {
        # Read only the text, strip an optional BOM, and avoid serializing FileInfo properties.
        $body = [System.IO.File]::ReadAllText($bodyPath, $utf8)
        if ($body.Length -gt 65536) { throw 'PR body exceeds the 65536 character limit.' }
        $temporaryBody = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($temporaryBody, $body, $utf8)
        & gh pr edit @prArgs --body-file $temporaryBody
        if ($LASTEXITCODE -ne 0) { throw "gh pr edit failed ($LASTEXITCODE)." }
    }
    & gh pr view @prArgs --json 'number,state,isDraft,mergeable,mergeStateStatus,url,headRefName,statusCheckRollup'
    if ($LASTEXITCODE -ne 0) { throw "gh pr view failed ($LASTEXITCODE)." }
}
finally {
    if ($temporaryBody) { [System.IO.File]::Delete($temporaryBody) }
    Pop-Location
}
