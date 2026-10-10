[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

try {
    # Dynamically select installed recognizer (e.g. en-US)
    $rec = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Select-Object -First 1
    if ($rec -ne $null) {
        $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($rec.Culture)
    } else {
        $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    }

    $engine.SetInputToDefaultAudioDevice()

    $commands = @(
        'open file explorer',
        'file explorer',
        'open files',
        'files',
        'explorer',
        'open google',
        'google',
        'open browser',
        'browser',
        'google search',
        'open notepad',
        'notepad',
        'text editor',
        'open calculator',
        'calculator',
        'calc',
        'open settings',
        'settings',
        'open task manager',
        'task manager',
        'what is on screen',
        'what is on my screen',
        'read screen',
        'active window',
        'desktop',
        'list windows',
        'open windows',
        'minimize window',
        'minimize',
        'close window',
        'close',
        'switch window',
        'next window',
        'volume up',
        'increase volume',
        'volume down',
        'decrease volume',
        'mute',
        'unmute',
        'help'
    )

    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]$commands)
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    if ($rec -ne $null) {
        $gb.Culture = $rec.Culture
    }

    # IMPORTANT: ONLY load the constrained CommandGrammar!
    # DO NOT load DictationGrammar so the engine is strictly forced to snap to our commands.
    $commandGrammar = New-Object System.Speech.Recognition.Grammar($gb)
    $commandGrammar.Name = "SystemCommands"
    $engine.LoadGrammar($commandGrammar)

    Write-Output "LISTENER_READY"
    [Console]::Out.Flush()

    while ($true) {
        # Perform constrained recognition on default laptop microphone
        $result = $engine.Recognize()
        if ($result -ne $null -and $result.Text -ne $null) {
            $recognizedText = $result.Text.Trim()
            if ($recognizedText.Length -gt 0) {
                Write-Output "RECOGNIZED:$recognizedText"
                [Console]::Out.Flush()
            }
        }
    }
} catch {
    Write-Output "LISTENER_ERROR:$($_.Exception.Message)"
    [Console]::Out.Flush()
}
