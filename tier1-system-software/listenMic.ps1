[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $engine.SetInputToDefaultAudioDevice()

    $commands = @(
        'open file explorer',
        'open files',
        'files',
        'open google',
        'open browser',
        'google',
        'open notepad',
        'open calculator',
        'open settings',
        'open task manager',
        'what is on screen',
        'what is on my screen',
        'read screen',
        'active window',
        'list windows',
        'open windows',
        'minimize window',
        'close window',
        'switch window',
        'volume up',
        'volume down',
        'mute',
        'help'
    )

    $choices = New-Object System.Speech.Recognition.Choices
    $choices.Add([string[]]$commands)
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $commandGrammar = New-Object System.Speech.Recognition.Grammar($gb)
    $commandGrammar.Name = "SystemCommands"
    $engine.LoadGrammar($commandGrammar)

    # Free-form dictation fallback
    try {
        $dictationGrammar = New-Object System.Speech.Recognition.DictationGrammar
        $dictationGrammar.Name = "Dictation"
        $engine.LoadGrammar($dictationGrammar)
    } catch {}

    Write-Output "LISTENER_READY"

    while ($true) {
        $result = $engine.Recognize()
        if ($result -ne $null -and $result.Text -ne $null -and $result.Confidence -gt 0.25) {
            Write-Output "RECOGNIZED:$($result.Text)"
        }
    }
} catch {
    Write-Output "LISTENER_ERROR:$($_.Exception.Message)"
}
