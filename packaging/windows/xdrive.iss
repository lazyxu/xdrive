#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#ifndef SourceDir
  #define SourceDir "."
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{9D7470E7-8FD9-4AE9-B9A1-1C8D860F43F1}
AppName=xDrive
AppVersion={#MyAppVersion}
AppPublisher=xDrive Project
AppPublisherURL=https://github.com/lazyxu/xdrive
AppSupportURL=https://github.com/lazyxu/xdrive/issues
DefaultDirName={localappdata}\Programs\xDrive
DefaultGroupName=xDrive
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=xDriveSetup-amd64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes
CloseApplications=yes
CloseApplicationsFilter=xdrive-agent.exe,xdrive-desktop.exe
RestartApplications=no
UninstallDisplayName=xDrive
SetupIconFile={#SourceDir}\icons\tray-normal.ico

[Files]
Source: "{#SourceDir}\xd.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\xdrive-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\desktop\*"; DestDir: "{app}\desktop"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\windows-legacy-cleanup.ps1"; Flags: dontcopy
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "xDriveAgent"; ValueData: """{app}\xdrive-agent.exe"""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\xd.exe"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe"; ValueType: string; ValueName: "Path"; ValueData: "{app}"
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xdrive-desktop.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\desktop\xdrive-desktop.exe"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xdrive-desktop.exe"; ValueType: string; ValueName: "Path"; ValueData: "{app}\desktop"

[Icons]
Name: "{group}\xDrive"; Filename: "{app}\desktop\xdrive-desktop.exe"; WorkingDir: "{app}\desktop"; AppUserModelID: "io.github.lazyxu.xdrive.desktop"
Name: "{group}\xDrive README"; Filename: "{app}\README.md"
Name: "{group}\Uninstall xDrive"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\xdrive-agent.exe"; Description: "Start xDrive background agent"; Flags: nowait runhidden; Check: ShouldStartAgent
Filename: "{app}\desktop\xdrive-desktop.exe"; Parameters: "--background"; Description: "Start xDrive Desktop in the background"; Flags: nowait runhidden; Check: ShouldStartDesktopBackground
Filename: "{app}\desktop\xdrive-desktop.exe"; Description: "Open xDrive Desktop"; Flags: nowait postinstall skipifsilent; Check: ShouldStartDesktopForeground

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM xdrive-desktop.exe /F >NUL 2>&1 & taskkill /IM xdrive-agent.exe /F >NUL 2>&1"; Flags: runhidden; RunOnceId: "StopXDriveProcesses"
Filename: "{app}\xd.exe"; Parameters: "cleanup"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "CleanupXDriveSyncRoot"

[Code]
function PathContains(const CurrentPath, Entry: String): Boolean;
var
  Haystack: String;
  Needle: String;
begin
  Haystack := ';' + Uppercase(CurrentPath) + ';';
  Needle := ';' + Uppercase(Entry) + ';';
  Result := Pos(Needle, Haystack) > 0;
end;

function HasCommandLineSwitch(const SwitchName: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do begin
    if CompareText(ParamStr(I), SwitchName) = 0 then begin
      Result := True;
      exit;
    end;
  end;
end;

function ShouldStartAgent(): Boolean;
begin
  Result := not HasCommandLineSwitch('/NOSTARTAGENT');
end;

function ShouldStartDesktop(): Boolean;
begin
  Result := not HasCommandLineSwitch('/NOSTARTDESKTOP');
end;

function ShouldStartDesktopBackground(): Boolean;
begin
  Result := ShouldStartDesktop() and WizardSilent();
end;

function ShouldStartDesktopForeground(): Boolean;
begin
  Result := ShouldStartDesktop() and not WizardSilent();
end;

function ShouldDeferLegacyCleanup(): Boolean;
begin
  Result := HasCommandLineSwitch('/DEFERLEGACYCLEANUP');
end;

procedure RunLegacyDesktopCleanup;
var
  ResultCode: Integer;
  ScriptPath: String;
  Params: String;
begin
  if ShouldDeferLegacyCleanup() then
    exit;
  ExtractTemporaryFile('windows-legacy-cleanup.ps1');
  ScriptPath := ExpandConstant('{tmp}\windows-legacy-cleanup.ps1');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptPath +
    '" -UnifiedAppDir "' + ExpandConstant('{app}') + '"';
  if not Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('legacy Desktop cleanup could not be started')
  else if ResultCode <> 0 then
    Log(Format('legacy Desktop cleanup exited with code %d', [ResultCode]));
end;

procedure AddAppToPath;
var
  CurrentPath: String;
  AppPath: String;
begin
  AppPath := ExpandConstant('{app}');
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then
    CurrentPath := '';
  if not PathContains(CurrentPath, AppPath) then begin
    if CurrentPath = '' then
      CurrentPath := AppPath
    else
      CurrentPath := CurrentPath + ';' + AppPath;
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', CurrentPath);
  end;
end;

procedure RemoveAppFromPath;
var
  CurrentPath: String;
  Wrapped: String;
  Needle: String;
  AppPath: String;
begin
  AppPath := ExpandConstant('{app}');
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then
    exit;
  Wrapped := ';' + CurrentPath + ';';
  Needle := ';' + AppPath + ';';
  StringChangeEx(Wrapped, Needle, ';', True);
  while (Length(Wrapped) > 0) and (Wrapped[1] = ';') do
    Delete(Wrapped, 1, 1);
  while (Length(Wrapped) > 0) and (Wrapped[Length(Wrapped)] = ';') do
    Delete(Wrapped, Length(Wrapped), 1);
  RegWriteExpandStringValue(HKCU, 'Environment', 'Path', Wrapped);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C taskkill /IM xdrive-desktop.exe /F >NUL 2>&1 & taskkill /IM xdrive-agent.exe /F >NUL 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    AddAppToPath;
    RunLegacyDesktopCleanup;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RemoveAppFromPath;
end;
