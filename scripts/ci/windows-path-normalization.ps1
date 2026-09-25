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
