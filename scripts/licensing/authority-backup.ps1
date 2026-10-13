[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('Backup', 'ValidateRestore')]
    [string] $Mode,
    [string] $Archive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:MaxArchiveBytes = 64MB
$script:MaxValidatorOutputBytes = 64KB
$script:MaxStderrBytes = 64KB
$script:ProcessTimeoutMs = 120000
$script:HostName = '145.223.121.144'
$script:UserName = 'deploy'
$script:RemoteBackup = '/home/deploy/gastronomy-licensing/scripts/authority-backup.sh'
$script:RemoteValidator = '/home/deploy/gastronomy-licensing/scripts/authority-restore-check.sh'
$script:BackupRoot = Join-Path $env:LOCALAPPDATA 'DeltaNube\LicensingBackups'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
public static class BoundedProcessIO {
  public sealed class Result { public byte[] Stdout; public byte[] Stderr; public int ExitCode; }
  static async Task<byte[]> ReadBounded(Stream s, int limit, CancellationToken ct) {
    using (var m = new MemoryStream()) {
      var b = new byte[8192]; int n;
      try {
        while ((n = await s.ReadAsync(b, 0, b.Length, ct).ConfigureAwait(false)) != 0) {
          if (m.Length + n > limit) throw new InvalidDataException("Process output exceeded limit");
          m.Write(b, 0, n);
        }
        return m.ToArray();
      } finally {
        Array.Clear(b, 0, b.Length);
        if (m.TryGetBuffer(out ArraySegment<byte> segment)) Array.Clear(segment.Array, 0, segment.Array.Length);
      }
    }
  }
  static async Task WriteInput(Stream s, byte[] input, CancellationToken ct) {
    if (input != null && input.Length != 0) await s.WriteAsync(input, 0, input.Length, ct).ConfigureAwait(false);
    s.Close();
  }
  public static Result Run(Process p, byte[] input, int stdoutLimit, int stderrLimit, int timeoutMs) {
    p.Start();
    using (var c = new CancellationTokenSource(timeoutMs)) {
      var stdout = ReadBounded(p.StandardOutput.BaseStream, stdoutLimit, c.Token);
      var stderr = ReadBounded(p.StandardError.BaseStream, stderrLimit, c.Token);
      var stdin = input == null ? Task.CompletedTask : WriteInput(p.StandardInput.BaseStream, input, c.Token);
      var wait = p.WaitForExitAsync(c.Token);
      try { Task.WhenAll(stdout, stderr, stdin, wait).GetAwaiter().GetResult(); }
      catch { try { if (!p.HasExited) p.Kill(true); } catch {} try { p.WaitForExit(5000); } catch {} throw; }
      return new Result { Stdout = stdout.GetAwaiter().GetResult(), Stderr = stderr.GetAwaiter().GetResult(), ExitCode = p.ExitCode };
    }
  }
}
'@

function Assert-PrivateDirectory {
    $local = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
    foreach ($path in @($local, (Join-Path $local 'DeltaNube'), $script:BackupRoot)) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Backup directory path contains an unsafe component.' }
        } elseif ($path -ne $local) { [void](New-Item -ItemType Directory -Path $path) }
    }
    if (Test-Path -LiteralPath $script:BackupRoot) {
        $item = Get-Item -LiteralPath $script:BackupRoot -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Backup directory exists but is not a safe ordinary directory.'
        }
    } else {
        [void](New-Item -ItemType Directory -Path $script:BackupRoot)
    }
    # Build a DACL-only descriptor: do not request owner or SACL privileges.
    # Set-Acl applies the access rules without attempting to change the owner.
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    foreach ($sid in @($me, $system)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($script:BackupRoot), $acl)
    $check = Get-Acl -LiteralPath $script:BackupRoot
    $allowed = @($check.Access | Where-Object { $_.AccessControlType -eq 'Allow' })
    $allowedSids = @($allowed | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
    if ($allowedSids | Where-Object { $_ -notin @($me.Value, $system.Value) }) {
        throw 'Backup directory ACL contains an unexpected allow principal.'
    }
}

function New-SshProcess {
    param([bool] $WithInput)
    $exe = (Get-Command ssh.exe -ErrorAction Stop).Source
    $p = [Diagnostics.Process]::new()
    $p.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $p.StartInfo.FileName = $exe
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    $p.StartInfo.RedirectStandardInput = $WithInput
    foreach ($arg in @('-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',"$($script:UserName)@$($script:HostName)")) { [void]$p.StartInfo.ArgumentList.Add($arg) }
    # The remote command is a fixed constant; no user input or secret enters argv.
    [void]$p.StartInfo.ArgumentList.Add($(if ($WithInput) { $script:RemoteValidator } else { $script:RemoteBackup }))
    return $p
}

function Invoke-BackupCapture {
    $p = New-SshProcess -WithInput $false
    $io = $null
    try {
        $io = [BoundedProcessIO]::Run($p, $null, $script:MaxArchiveBytes, $script:MaxStderrBytes, $script:ProcessTimeoutMs)
        if ($io.ExitCode -ne 0) { throw 'Remote backup failed; stderr suppressed.' }
        if ($io.Stdout.Length -eq 0) { throw 'Remote backup returned an empty archive.' }
        return ,$io.Stdout
    } catch {
        if ($p -and -not $p.HasExited) { try { $p.Kill($true); $p.WaitForExit() } catch {} }
        throw 'Remote backup failed, timed out, or exceeded a safety limit.'
    } finally {
        if ($io -and $io.Stderr) { [Array]::Clear($io.Stderr, 0, $io.Stderr.Length) }
        $p.Dispose()
    }
}

function Send-ArchiveToValidator([byte[]] $Bytes) {
    $p = New-SshProcess -WithInput $true
    $io = $null
    try {
        $io = [BoundedProcessIO]::Run($p, $Bytes, $script:MaxValidatorOutputBytes, $script:MaxStderrBytes, $script:ProcessTimeoutMs)
        if ($io.ExitCode -ne 0) { throw 'Isolated restore validation failed; stderr suppressed.' }
        $out = [Text.Encoding]::UTF8.GetString($io.Stdout)
        try { $receipt = $out | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Restore validator did not return valid JSON.' }
        if ($receipt.status -ne 'validated' -or $receipt.production_changed -ne $false) { throw 'Restore validator returned an unexpected result.' }
        return $receipt
    } catch {
        if ($p -and -not $p.HasExited) { try { $p.Kill($true); $p.WaitForExit() } catch {} }
        throw
    } finally {
        if ($io) { if ($io.Stdout) { [Array]::Clear($io.Stdout, 0, $io.Stdout.Length) }; if ($io.Stderr) { [Array]::Clear($io.Stderr, 0, $io.Stderr.Length) } }
        $p.Dispose()
    }
}

function Assert-SafeArchivePath([string] $Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($script:BackupRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetDirectoryName($full).TrimEnd('\') -ne [IO.Path]::GetFullPath($script:BackupRoot).TrimEnd('\')) { throw 'Archive must be a direct child of the private backup directory.' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt ($script:MaxArchiveBytes + 4096)) { throw 'Archive must be a bounded ordinary file, not a directory or reparse point.' }
    return $full
}

function Protect-ArchiveBytes([byte[]] $Bytes, [byte[]] $Entropy) {
    $plainHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant()
    $protected = [Security.Cryptography.ProtectedData]::Protect($Bytes, $Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $encryptedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($protected)).ToLowerInvariant()
    return [pscustomobject]@{ Protected = $protected; PlainHash = $plainHash; EncryptedHash = $encryptedHash }
}

try {
    Assert-PrivateDirectory
    $entropy = [Text.Encoding]::UTF8.GetBytes('DeltaNube licensing authority backup v1')
    if ($Mode -eq 'Backup') {
        $plain = Invoke-BackupCapture
        $protected = $null
        try {
            $archiveProtection = Protect-ArchiveBytes $plain $entropy
            $protected = $archiveProtection.Protected
            $hash = $archiveProtection.PlainHash
            $encryptedHash = $archiveProtection.EncryptedHash
            $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
            $dest = Join-Path $script:BackupRoot "authority-$stamp.dnbak"
            if (Test-Path -LiteralPath $dest) { throw 'Backup target already exists; refusing to overwrite.' }
            $temp = Join-Path $script:BackupRoot ('.tmp-' + [Guid]::NewGuid().ToString('N'))
            try {
                $fs = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try { $fs.Write($protected, 0, $protected.Length); $fs.Flush($true) } finally { $fs.Dispose() }
                [IO.File]::Move($temp, $dest)
            } finally { if (Test-Path -LiteralPath $temp -PathType Leaf) { Remove-Item -LiteralPath $temp -Force } }
            $receipt = [ordered]@{ version = 1; created_utc = [DateTime]::UtcNow.ToString('o'); archive = [IO.Path]::GetFileName($dest); sha256_plaintext = $hash; sha256_encrypted = $encryptedHash; encrypted_bytes = $protected.Length; encrypted = $true; scope = 'Windows DPAPI CurrentUser' }
            $json = $receipt | ConvertTo-Json -Compress
            [IO.File]::WriteAllText((Join-Path $script:BackupRoot ("authority-$stamp.receipt.json")), $json, [Text.UTF8Encoding]::new($false))
            Write-Output $json
        } finally {
            if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
            if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
        }
    } else {
        if (-not $Archive) { throw 'Specify -Archive with an encrypted archive path.' }
        $path = Assert-SafeArchivePath $Archive
        if ((Get-Item -LiteralPath $path).Length -gt ($script:MaxArchiveBytes + 4096)) { throw 'Encrypted archive exceeds the size limit.' }
        $encrypted = [IO.File]::ReadAllBytes($path)
        $plain = $null
        try {
            $receiptPath = [IO.Path]::ChangeExtension($path, '.receipt.json')
            $receiptFile = Get-Item -LiteralPath $receiptPath -Force -ErrorAction Stop
            if ($receiptFile.PSIsContainer -or ($receiptFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $receiptFile.Length -gt 4096) { throw 'Receipt file is unsafe or too large.' }
            $receipt = [IO.File]::ReadAllText($receiptPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
            if ($receipt.archive -ne [IO.Path]::GetFileName($path) -or $receipt.encrypted_bytes -ne $encrypted.Length) { throw 'Receipt does not identify this encrypted archive.' }
            $encryptedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($encrypted)).ToLowerInvariant()
            if ($encryptedHash -cne $receipt.sha256_encrypted) { throw 'Encrypted archive hash does not match its receipt.' }
            $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            if ($plain.Length -eq 0 -or $plain.Length -gt $script:MaxArchiveBytes) { throw 'Decrypted archive has an invalid size.' }
            $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($plain)).ToLowerInvariant()
            if ($hash -cne $receipt.sha256_plaintext) { throw 'Archive hash does not match its receipt.' }
            $result = Send-ArchiveToValidator $plain
            Write-Output ($result | ConvertTo-Json -Compress)
        } finally {
            if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
            if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
        }
    }
} catch {
    # Messages are deliberately generic: never echo SSH stderr or archive content.
    [Console]::Error.WriteLine('authority-backup: operation failed; details suppressed.')
    exit 1
}
