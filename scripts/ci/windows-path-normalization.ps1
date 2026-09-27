function Get-XDriveComparablePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$WindowsDirectory = $env:WINDIR,
        [bool]$Wow64Process = ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess)
    )

    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    if (-not $Wow64Process) {
        return $full
    }

    $windows = [System.IO.Path]::GetFullPath($WindowsDirectory).TrimEnd('\')
    $canonicalProfile = Join-Path $windows "System32\config\systemprofile"
    foreach ($alias in @(
        $canonicalProfile,
        (Join-Path $windows "SysWOW64\config\systemprofile")
    )) {
        $aliasFull = [System.IO.Path]::GetFullPath($alias).TrimEnd('\')
        if ([string]::Equals($full, $aliasFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $canonicalProfile
        }
        $prefix = $aliasFull + "\"
        if ($full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $canonicalProfile + $full.Substring($aliasFull.Length)
        }
    }

    return $full
}

function Get-XDriveStartMenuProgramPaths {
    param(
        [string]$AppData = $env:APPDATA,
        [string]$KnownPrograms = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs),
        [string]$CommonPrograms = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms),
        [bool]$Is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
    )

    $paths = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($knownPrograms)) {
        $paths.Add($knownPrograms)
    }

    if (-not [string]::IsNullOrWhiteSpace($AppData)) {
        $appDataPrograms = Join-Path $AppData "Microsoft\Windows\Start Menu\Programs"
        if ($Is64BitOperatingSystem) {
            if ($appDataPrograms -match '(?i)\\System32\\config\\systemprofile\\') {
                $paths.Add(($appDataPrograms -replace '(?i)\\System32\\config\\systemprofile\\', '\SysWOW64\config\systemprofile\'))
            } elseif ($appDataPrograms -match '(?i)\\SysWOW64\\config\\systemprofile\\') {
                $paths.Add(($appDataPrograms -replace '(?i)\\SysWOW64\\config\\systemprofile\\', '\System32\config\systemprofile\'))
            }
        }
        $paths.Add($appDataPrograms)
    }

    if (-not [string]::IsNullOrWhiteSpace($commonPrograms)) {
        $paths.Add($commonPrograms)
    }

    return $paths | Select-Object -Unique
}
