param([string]$Database='musonoi_v26_development_test',[string]$At='03:00',[switch]$Register)
$ErrorActionPreference='Stop'
if($Database -notmatch '^musonoi_[a-z0-9_]+_test$' -or $At -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$'){throw 'Invalid TEST database or local scheduled time'}
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskScript=Join-Path $PSScriptRoot 'daily-backup.ps1'
function XmlText([string]$value){return [Security.SecurityElement]::Escape($value)}
$taskUser=XmlText ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$taskArguments=XmlText ('-NoProfile -NonInteractive -File "'+$taskScript+'" -Database '+$Database)
$taskWorking=XmlText $taskRoot
$taskBoundary=(Get-Date -Format 'yyyy-MM-dd')+'T'+$At+':00'
$taskXml=@"
<?xml version="1.0" encoding="utf-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>Musonoi WMS TEST daily backup; retention 14 daily, 8 weekly, 12 monthly.</Description></RegistrationInfo>
 <Triggers><CalendarTrigger><StartBoundary>$taskBoundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
 <Principals><Principal id="Author"><UserId>$taskUser</UserId><LogonType>S4U</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT2H</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
 <Actions Context="Author"><Exec><Command>pwsh.exe</Command><Arguments>$taskArguments</Arguments><WorkingDirectory>$taskWorking</WorkingDirectory></Exec></Actions>
</Task>
"@
$taskXmlPath=Join-Path $taskRoot '.runtime/v27-daily-backup-task.xml'
[IO.File]::WriteAllText($taskXmlPath,$taskXml,[Text.Encoding]::Unicode)
$null=[xml]$taskXml
if($Register){Register-ScheduledTask -TaskName ('Musonoi-WMS-Daily-'+$Database) -Xml $taskXml -Force | Out-Null;Write-Output 'Scheduled on this TEST host. Check run-as permissions, pwsh path and first successful execution.'}else{Write-Output 'Valid task XML generated only; no schedule installed. Review the actual host and run-as permissions before using -Register.'}
