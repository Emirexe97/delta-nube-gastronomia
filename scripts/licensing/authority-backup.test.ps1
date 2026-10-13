[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
    Write-Output 'SKIP: authority backup regression harness requires Windows PowerShell 7 / DPAPI.'
    exit 0
}

$sourcePath = Join-Path $PSScriptRoot 'authority-backup.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Production script failed PowerShell parsing.' }

function Get-FunctionSource([string] $Name) {
    $node = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name }, $true)
    if (-not $node) { throw "Production function missing: $Name" }
    return $node.Extent.Text
}

# Extract the exact helper definitions from the production AST. This harness
# never invokes the production script's top-level code or SSH functions.
. ([scriptblock]::Create((Get-FunctionSource 'Protect-ArchiveBytes')))

$addType = $ast.Find({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type' }, $true)
if (-not $addType) { throw 'Production bounded I/O helper is missing.' }
$csharpNode = $addType.CommandElements | Where-Object { $_ -is [Management.Automation.Language.StringConstantExpressionAst] -and $_.Value -match 'class BoundedProcessIO' } | Select-Object -First 1
$csharp = if ($csharpNode) { $csharpNode.Value } else { $null }
if (-not $csharp) { throw 'Could not extract production bounded I/O helper from AST.' }
Add-Type -TypeDefinition $csharp

$entropy = [Text.Encoding]::UTF8.GetBytes('DeltaNube licensing authority backup v1')
$testBytes = [byte[]](13, 37, 73, 109, 151, 199)
$metadata = Protect-ArchiveBytes $testBytes $entropy
try {
    $actualPlainHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($testBytes)).ToLowerInvariant()
    $actualProtectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($metadata.Protected)).ToLowerInvariant()
    if ($metadata.PlainHash -cne $actualPlainHash) { throw 'Plaintext hash metadata mismatch.' }
    if ($metadata.EncryptedHash -cne $actualProtectedHash) { throw 'Encrypted hash metadata mismatch; ciphertext must be hashed after Protect().' }
    $roundTrip = [Security.Cryptography.ProtectedData]::Unprotect($metadata.Protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ([Convert]::ToBase64String($roundTrip) -cne [Convert]::ToBase64String($testBytes)) { throw 'DPAPI roundtrip failed.' }
    [Array]::Clear($roundTrip, 0, $roundTrip.Length)

    $tampered = [byte[]]$metadata.Protected.Clone()
    $tampered[0] = $tampered[0] -bxor 1
    $tamperRejected = $false
    try { [void][Security.Cryptography.ProtectedData]::Unprotect($tampered, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser) } catch { $tamperRejected = $true }
    [Array]::Clear($tampered, 0, $tampered.Length)
    if (-not $tamperRejected) { throw 'DPAPI accepted modified ciphertext.' }
    Write-Output 'PASS: DPAPI CurrentUser roundtrip, post-Protect ciphertext hash, receipt metadata, and tamper rejection.'
} finally {
    [Array]::Clear($testBytes, 0, $testBytes.Length)
    if ($metadata.Protected) { [Array]::Clear($metadata.Protected, 0, $metadata.Protected.Length) }
}

function New-TestProcess([string] $Command) {
    $p = [Diagnostics.Process]::new()
    $p.StartInfo.FileName = (Get-Command pwsh.exe -ErrorAction Stop).Source
    foreach ($arg in @('-NoProfile', '-NonInteractive', '-Command', $Command)) { [void]$p.StartInfo.ArgumentList.Add($arg) }
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    return $p
}

$p = New-TestProcess '[Console]::OpenStandardOutput().WriteByte(65)'
try {
    $result = [BoundedProcessIO]::Run($p, $null, 16, 16, 5000)
    if ($result.ExitCode -ne 0 -or $result.Stdout.Length -ne 1 -or $result.Stdout[0] -ne 65) { throw 'Bounded process success case failed.' }
    [Array]::Clear($result.Stdout, 0, $result.Stdout.Length)
    [Array]::Clear($result.Stderr, 0, $result.Stderr.Length)
} finally { $p.Dispose() }
Write-Output 'PASS: bounded process success.'

$capRejected = $false
$p = New-TestProcess '[Console]::OpenStandardOutput().Write([byte[]]::new(128), 0, 128)'
try { [void][BoundedProcessIO]::Run($p, $null, 16, 16, 5000) } catch { $capRejected = $true } finally { $p.Dispose() }
if (-not $capRejected) { throw 'Bounded process accepted excessive stdout.' }
Write-Output 'PASS: bounded process output cap and process-tree termination.'

$timeoutRejected = $false
$p = New-TestProcess 'Start-Sleep -Seconds 10'
try { [void][BoundedProcessIO]::Run($p, $null, 16, 16, 100) } catch { $timeoutRejected = $true } finally { $p.Dispose() }
if (-not $timeoutRejected) { throw 'Bounded process did not enforce timeout.' }
Write-Output 'PASS: bounded process timeout.'

$nonzero = $false
$p = New-TestProcess 'exit 7'
try {
    $result = [BoundedProcessIO]::Run($p, $null, 16, 16, 5000)
    $nonzero = $result.ExitCode -eq 7
    if ($result.Stdout) { [Array]::Clear($result.Stdout, 0, $result.Stdout.Length) }
    if ($result.Stderr) { [Array]::Clear($result.Stderr, 0, $result.Stderr.Length) }
} finally { $p.Dispose() }
if (-not $nonzero) { throw 'Bounded process failed to report nonzero exit status.' }
Write-Output 'PASS: bounded process nonzero exit handling.'

Write-Output 'All authority backup regression checks passed; no test bytes or secrets were printed.'
