# Handsfree — Tier 1 Native Desktop System Software

The **Tier 1 System Software** is the native OS-level assistive application for Windows. It operates independently outside the web browser, runs automatically on Windows boot, and gives motor-impaired and blind users complete hands-free voice and screen dictation control over the entire operating system.

---

## 🌟 Key Features

1. **Auto-Boot on System Startup:**
   - Registers automatically in Windows Startup.
   - Starts silently on system boot with a welcome audio chime.

2. **System-Level Screen Dictator (For Blind Users):**
   - *"What is on screen?"* / *"Read screen"* — Detects and speaks the currently active foreground window name and process.
   - *"List windows"* — Enumerates all open application windows on the desktop.

3. **OS-Level Voice Commands (App Launchers):**
   - *"Open File Explorer"* — Launches Windows File Explorer (`explorer.exe`).
   - *"Open Google"* — Launches default browser directly to Google Search.
   - *"Open Notepad"* — Opens Windows Notepad.
   - *"Open Settings"* — Opens Windows System Settings.
   - *"Open Calculator"* / *"Open Task Manager"*.

4. **Native Window & Volume Management:**
   - *"Minimize window"* / *"Close window"* / *"Switch window"*.
   - *"Volume up"* / *"Volume down"* / *"Mute"*.
   - *"Scroll down"* / *"Scroll up"*.

5. **100% Offline Audio & Voice Engine:**
   - Uses built-in Windows SAPI speech synthesis and synthesized earcon sound cues with **zero external dependencies**.

---

## 🚀 How to Run & Test

Navigate to the `tier1-system-software` folder:

```bash
cd tier1-system-software
```

### 1. Start the System Assistant
```bash
npm start
```
You will hear an audio earcon chime and the voice say:
> *"Handsfree System Assistant is active. Listening for commands."*

### 2. Test Commands
Type (or speak) commands in the terminal:
- `open file explorer` $\rightarrow$ File Explorer opens!
- `open google` $\rightarrow$ Browser opens to Google!
- `what is on screen` $\rightarrow$ Tells you the active window!
- `open notepad` $\rightarrow$ Opens Notepad!
- `volume up` $\rightarrow$ Increases PC master volume!
- `help` $\rightarrow$ Lists all commands!

---

## ⚙️ Enabling / Disabling Auto-Boot on Windows Startup

To have it automatically start every time you turn on your PC:
```bash
npm run enable-startup
```

To turn off auto-startup:
```bash
npm run disable-startup
```
