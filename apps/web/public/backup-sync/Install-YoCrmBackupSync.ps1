#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Disable,
    [switch]$Remove,
    [string]$Origin = 'https://crm.yoleotard.com'
)
$ErrorActionPreference = 'Stop'
$TaskName = 'YOCRMBackupSync'
$InstallDir = Join-Path $env:LOCALAPPDATA 'YOCRMBackup'
$HelperPath = Join-Path $InstallDir 'yocrm_backup_sync.py'
$ExpectedSHA256 = '9f24ee9ba376ecebd73434bf42ffaef9d26769e2b6579bed8e5ead692d4f8853'

if ($Disable -and $Remove) { throw 'Укажите только один параметр: -Disable или -Remove.' }
if ($Disable -or $Remove) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Disable-ScheduledTask -TaskName $TaskName | Out-Null
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($Remove) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    }
    if ($Remove) {
        if ((Test-Path -LiteralPath $InstallDir) -and
            ((Get-Item -LiteralPath $InstallDir).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Папка установки не должна быть ссылкой; удаление файлов остановлено.'
        }
        # Explicit files only; downloaded backup archives are never removed.
        foreach ($name in @('config.dpapi', 'state.json', 'run.lock', 'yocrm_backup_sync.py')) {
            $path = Join-Path $InstallDir $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
        Write-Host 'Задача и локальная настройка удалены. Скачанные архивы сохранены.'
    } else { Write-Host 'Автоматическое скачивание отключено. Архивы и настройка сохранены.' }
    return
}

Write-Host 'YO CRM — установка скачивания существующих резервных архивов.'
Write-Host 'Задача работает при входе в Windows и каждые 5 минут, пока вы вошли в систему.'
$answer = Read-Host "Адрес CRM (Enter: $Origin)"
if ($answer) { $Origin = $answer }
$uri = $null
if (-not [Uri]::TryCreate($Origin, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
    $uri.AbsolutePath -ne '/' -or $Origin -match '\s') {
    throw 'Нужен HTTPS-адрес CRM без пути, логина и параметров.'
}
$Origin = $uri.GetLeftPart([UriPartial]::Authority)
$Folder = Read-Host 'Резервная папка, если сервер не указал свою (Enter: D:\YO_CRM_Backups)'
if (-not $Folder) { $Folder = 'D:\YO_CRM_Backups' }
if ($Folder -notmatch '^[A-Za-z]:\\' -or $Folder -match '[\r\n]' -or
    ($Folder -split '\\') -contains '..') { throw 'Нужен абсолютный путь к локальному диску.' }

# Discover a real Python 3 installation (not the Microsoft Store alias).
$PythonExe = $null
foreach ($candidate in @(@{ Name = 'py.exe'; Args = @('-3') }, @{ Name = 'python.exe'; Args = @() })) {
    $command = Get-Command $candidate.Name -ErrorAction SilentlyContinue
    if (-not $command) { continue }
    $candidateArgs = $candidate.Args
    try {
        $probe = & $command.Source @candidateArgs -c 'import sys; print(sys.executable if sys.version_info >= (3, 9) else "")' 2>$null
    } catch { continue }
    if ($LASTEXITCODE -eq 0 -and $probe -and (Test-Path -LiteralPath ([string]$probe))) {
        $PythonExe = [string]$probe
        break
    }
}
if (-not $PythonExe) { throw 'Установите Python 3.9+ для текущего пользователя и повторите установку.' }
$PythonwExe = Join-Path (Split-Path -Parent $PythonExe) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $PythonwExe)) { throw 'Рядом с Python не найден pythonw.exe.' }

# Private directory before writing any settings. Never inspect existing credentials.
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (Test-Path -LiteralPath $InstallDir) {
    if ((Get-Item -LiteralPath $InstallDir).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Папка установки не должна быть ссылкой.'
    }
} else { New-Item -ItemType Directory -Path $InstallDir | Out-Null }
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($Sid)))
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($Sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $InstallDir -AclObject $acl
foreach ($item in Get-ChildItem -LiteralPath $InstallDir -Force) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'В папке установки найдена ссылка.' }
    if ($item.PSIsContainer) { throw 'В папке установки обнаружена неожиданная подпапка.' }
    # Reset old explicit rules so existing settings inherit the private user ACL.
    & icacls.exe $item.FullName /reset /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить доступ к локальной настройке.' }
}

# TLS verification is always enabled; redirects (including to another host) refused.
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$handler = New-Object Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)
$client.MaxResponseContentBufferSize = 1048576
$Temporary = Join-Path $InstallDir ('helper-' + [Guid]::NewGuid().ToString('N') + '.tmp')
try {
    $response = $client.GetAsync("$Origin/backup-sync/yocrm_backup_sync.py").GetAwaiter().GetResult()
    try {
        if ([int]$response.StatusCode -ne 200) { throw 'Не удалось загрузить helper с адреса CRM.' }
        $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        if ($bytes.Length -gt 1048576) { throw 'Недопустимый размер helper.' }
        [IO.File]::WriteAllBytes($Temporary, $bytes)
    } finally { $response.Dispose() }
    if ((Get-FileHash -LiteralPath $Temporary -Algorithm SHA256).Hash -ne $ExpectedSHA256) {
        throw 'SHA256 helper не совпадает. Установка остановлена.'
    }
    Move-Item -LiteralPath $Temporary -Destination $HelperPath -Force
} finally {
    if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force }
    $client.Dispose()
    $handler.Dispose()
}

$Token = Read-Host 'Введите токен сопряжения из CRM (ввод скрыт)' -AsSecureString
$bstr = [IntPtr]::Zero
$process = $null
try {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $PythonExe
    $start.Arguments = '-I -B "' + $HelperPath + '" --setup'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $process = [Diagnostics.Process]::Start($start)
    # StandardInputEncoding is unavailable in Windows PowerShell 5.1/.NET Framework.
    # Write explicit UTF-8 bytes, decoded explicitly by Python regardless of locale.
    function Write-PipeLine([string]$Value) {
        $encoded = [Text.Encoding]::UTF8.GetBytes($Value + "`n")
        try { $process.StandardInput.BaseStream.Write($encoded, 0, $encoded.Length) }
        finally { [Array]::Clear($encoded, 0, $encoded.Length) }
    }
    Write-PipeLine $Origin
    Write-PipeLine $Folder
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Token)
    # Plaintext exists only in process memory and the anonymous stdin pipe.
    Write-PipeLine ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Не удалось сохранить настройку через Windows DPAPI.' }
} finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($Token) { $Token.Dispose() }
    if ($process) { $process.Dispose() }
}

$action = New-ScheduledTaskAction -Execute $PythonwExe -Argument ('-I -B "' + $HelperPath + '" --run') -WorkingDirectory $InstallDir
$logon = New-ScheduledTaskTrigger -AtLogOn -User $Sid
$poll = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $Sid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$task = New-ScheduledTask -Action $action -Trigger @($logon, $poll) -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host 'Установка завершена. Проверки каждые 5 минут; скачивание — по режиму и интервалу CRM.'
Write-Host 'Отключение: .\Install-YoCrmBackupSync.ps1 -Disable; удаление настройки: -Remove.'
