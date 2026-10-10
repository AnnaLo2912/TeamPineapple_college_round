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
        'open google', 'google', 'open browser', 'browser', 'google chrome', 'chrome', 'google search', 'open internet', 'internet',
        'open file explorer', 'file explorer', 'open files', 'files', 'explorer', 'open my files', 'folders',
        'open notepad', 'notepad', 'text editor', 'open notes', 'notes',
        'open calculator', 'calculator', 'calc',
        'open settings', 'settings', 'windows settings',
        'open task manager', 'task manager',
        'what is on screen', 'what is on my screen', "what's on screen", 'read screen', 'screen', 'active window', 'current window', 'desktop', 'the desktop', 'where am i',
        'list windows', 'open windows', 'what windows are open',
        'minimize window', 'minimize',
        'close window', 'close',
        'switch window', 'next window',
        'volume up', 'increase volume',
        'volume down', 'decrease volume',
        'mute', 'unmute',
        'help',
        # Phonetic variants
        'the index topped', 'next stop', 'x taco liar', 'textile', 'ie to extort all'
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
        # Auto-exit if parent Node process has closed
        if ($parentPid) {
            $parent = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
            if (-not $parent) {
                break
            }
        }

        try {
            $result = $engine.Recognize([TimeSpan]::FromSeconds(3))
            if ($result -ne $null -and $result.Text -ne $null) {
                $recognizedText = $result.Text.Trim()
                if ($recognizedText.Length -gt 0) {
                    Write-Output "RECOGNIZED:$recognizedText"
                    [Console]::Out.Flush()
                }
            }
        } catch {
            Start-Sleep -Milliseconds 150
        }
    }
} catch {
    Write-Output "LISTENER_ERROR:$($_.Exception.Message)"
    [Console]::Out.Flush()
}
