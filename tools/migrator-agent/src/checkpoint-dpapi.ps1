$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$lock = $null
try {
    Add-Type -AssemblyName System.Security
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    $folder = [IO.Path]::GetFullPath($request.folder)
    # Reject junctions/symlinks in every existing ancestor, before creating anything.
    $cursor = $folder
    while ($cursor) {
        if ([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) {
            if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe path' }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    if (-not [IO.Directory]::Exists($folder)) {
        [IO.Directory]::CreateDirectory($folder, $acl) | Out-Null
    }
    [IO.Directory]::SetAccessControl($folder, $acl)
    # Existing files must inherit the same private ACL; never follow reparse points.
    foreach ($item in Get-ChildItem -LiteralPath $folder -Force) {
        if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Unsafe entry' }
        $fileAcl = New-Object Security.AccessControl.FileSecurity
        $fileAcl.SetOwner($sid)
        $fileAcl.SetAccessRuleProtection($true, $false)
        $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
        [IO.File]::SetAccessControl($item.FullName, $fileAcl)
    }
    $lock = [IO.File]::Open([IO.Path]::Combine($folder, '.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    [Console]::Out.WriteLine('{"ready":true}')
    while ($null -ne ($line = [Console]::In.ReadLine())) {
        $request = $line | ConvertFrom-Json
        $bytes = [Convert]::FromBase64String($request.data)
        try {
            if ($request.op -eq 'protect') {
                $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            } elseif ($request.op -eq 'unprotect') {
                $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            } else { throw 'Invalid operation' }
            [Console]::Out.WriteLine('{"data":"' + [Convert]::ToBase64String($result) + '"}')
        } finally {
            [Array]::Clear($bytes, 0, $bytes.Length)
            if ($result) { [Array]::Clear($result, 0, $result.Length) }
        }
    }
} catch {
    # Never forward PowerShell errors: they can include request values.
    [Console]::Out.WriteLine('{"error":true}')
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
