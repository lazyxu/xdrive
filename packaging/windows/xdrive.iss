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
CloseApplicationsFilter=xdrive-agent.exe
RestartApplications=no
UninstallDisplayName=xDrive Client
SetupIconFile={#SourceDir}\icons\tray-normal.ico

[Files]
Source: "{#SourceDir}\xd.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\xdrive-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\icons\*.ico"; DestDir: "{app}\icons"; Flags: ignoreversion
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "xDriveAgent"; ValueData: """{app}\xdrive-agent.exe"""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\xd.exe"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\xd.exe"; ValueType: string; ValueName: "Path"; ValueData: "{app}"

[Icons]
Name: "{userprograms}\\xDrive"; Filename: "{app}\\xdrive-agent.exe"; WorkingDir: "{app}"; IconFilename: "{app}\\icons\\tray-normal.ico"
Name: "{group}\xDrive README"; Filename: "{app}\README.md"
Name: "{group}\Uninstall xDrive"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\xdrive-agent.exe"; Description: "Start xDrive background agent"; Flags: nowait runhidden; Check: ShouldStartAgent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM xdrive-agent.exe /F >NUL 2>&1"; Flags: runhidden; RunOnceId: "StopXDriveAgent"
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

function ShouldStartAgent(): Boolean;
var
  I: Integer;
begin
  Result := True;
  for I := 1 to ParamCount do begin
    if CompareText(ParamStr(I), '/NOSTARTAGENT') = 0 then begin
      Result := False;
      exit;
    end;
  end;
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
  Exec(ExpandConstant('{cmd}'), '/C taskkill /IM xdrive-agent.exe /F >NUL 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    AddAppToPath;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RemoveAppFromPath;
end;
