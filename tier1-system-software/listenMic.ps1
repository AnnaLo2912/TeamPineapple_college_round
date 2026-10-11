[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

try {
    $rec = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Select-Object -First 1
    if ($rec -ne $null) {
        $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($rec.Culture)
    } else {
        $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    }

    $engine.SetInputToDefaultAudioDevice()

    $commands = @(
        'click', 'click link', 'click it', 'click here', 'tap',
        'open google', 'google search', 'open browser', 'google chrome', 'open internet', 'google', 'browser', 'chrome',
        'open file explorer', 'file explorer', 'open files', 'open my files', 'open folders', 'explorer', 'files',
        'open notepad', 'notepad', 'open text editor', 'open notes',
        'open calculator', 'calculator', 'calc',
        'open settings', 'windows settings', 'settings',
        'open task manager', 'task manager',
        'what is on screen', 'what is on my screen', "what's on screen", 'read screen', 'screen overview', 'active window', 'current window', 'where am i', 'desktop', 'screen',
        'list windows', 'open windows', 'what windows are open',
        'open tools', 'open tools folder', 'tools folder', 'tools',
        'open brave', 'brave browser', 'brave',
        'open code', 'open visual studio code', 'visual studio code', 'open vs code', 'vs code',
        'open resume', 'my resume', 'resume',
        'what files are in downloads', 'read downloads', 'open downloads', 'downloads',
        'what files are in documents', 'read documents', 'open documents', 'documents',
        'what files are on desktop', 'read desktop files',
        'minimize window', 'minimize this window', 'minimize',
        'close window', 'close this window', 'close',
        'switch window', 'next window',
        'volume up', 'increase volume',
        'volume down', 'decrease volume',
        'mute audio', 'unmute audio', 'mute', 'unmute',
        'help', 'what can you do'
    )

    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]$commands)
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    if ($rec -ne $null) {
        $gb.Culture = $rec.Culture
    }

    $commandGrammar = New-Object System.Speech.Recognition.Grammar($gb)
    $commandGrammar.Name = "SystemCommands"
    $engine.LoadGrammar($commandGrammar)

    $parentProc = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    $parentPid = if ($parentProc) { $parentProc.ParentProcessId } else { $null }

    Write-Output "LISTENER_READY"
    [Console]::Out.Flush()

    while ($true) {
        # Terminate if parent Node process has closed so microphone is never locked
        if ($parentPid) {
            $parent = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
            if (-not $parent) {
                break
            }
        }

        try {
            # Continuous recognition on default laptop microphone without timeout slicing
            $result = $engine.Recognize()
            if ($result -ne $null -and $result.Text -ne $null) {
                $confidence = [Math]::Round([float]$result.Confidence, 2)
                # Keep accessible threshold so natural accents register smoothly
                if ($confidence -ge 0.20) {
                    $recognizedText = $result.Text.Trim()
                    if ($recognizedText.Length -gt 0) {
                        Write-Output "RECOGNIZED:$recognizedText|$confidence"
                        [Console]::Out.Flush()
                    }
                }
            }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
} catch {
    Write-Output "LISTENER_ERROR:$($_.Exception.Message)"
    [Console]::Out.Flush()
}
