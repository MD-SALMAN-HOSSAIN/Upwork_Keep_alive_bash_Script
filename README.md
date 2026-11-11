# Dashboard Session Keep-Alive

Keeps an Upwork dashboard refreshed at randomized 4–9 minute intervals. There are two options:

- **Extension:** runs inside your existing, already-logged-in Chrome profile. Best if you do not want a second browser window.
- **Node/Puppeteer script:** attaches over CDP to a separate Chrome started with remote debugging. Best for a scriptable, cross-platform setup.

Neither option stores or logs your password. Authentication stays in Chrome's profile.

## How it works

1. You start Chrome with `--remote-debugging-port=9222` and log in manually once.
2. `keepalive.js` connects with `puppeteer-core` to `http://127.0.0.1:9222`.
3. It finds an existing dashboard tab (or opens one) and reloads it on a randomized schedule.
4. Authentication stays inside Chrome's profile; no credentials exist in the script or its environment.
5. `Ctrl+C` disconnects from Chrome but leaves the browser window open.

The interval is randomized using a triangular distribution between `MIN_MINUTES` and `MAX_MINUTES`, with a short random pause before each reload. This avoids an exactly fixed cadence and is gentler on the server.

## Use your existing Chrome (extension)

Chrome 136+ ignores remote debugging on the default Chrome profile, so `keepalive.js` cannot attach to an already-open normal Chrome window. If you are already logged in there, load the extension in `chrome-extension/` instead:

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select the `chrome-extension` folder.
3. Pin **Dashboard Keep-Alive**.
4. The extension opens or reuses an Upwork tab in your current Chrome window and starts automatically.

If it does not start automatically, open your Upwork dashboard, click the extension, set 4–9 minutes, and click **Start on this tab**. If you already loaded an older copy, click the circular Reload icon on its card in `chrome://extensions` so the auto-open code takes effect.

The extension runs inside your existing profile, uses `chrome.alarms` for randomized reloads, waits if it detects a login page, and reopens the dashboard tab if you close it. It does not use the debug port or a second browser window. Click **Stop** in the popup to stop it.

## Windows quick start

Double-click `START_HERE.bat`. It starts Chrome with remote debugging, opens the dashboard, and launches the keep-alive in a new window. On the first run, log in to Upwork in the Chrome window; the script waits for login. Close the keep-alive window or press `Ctrl+C` to stop.

If you are already logged in in your normal Chrome, use the extension above instead. The manual steps below are for macOS/Linux or if you prefer running the script yourself.

## 1. Start Chrome with remote debugging

Chrome 136+ ignores `--remote-debugging-port` when the default profile is used. Pass a dedicated `--user-data-dir`, log in once, and the session will persist there.

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.chrome-debug-profile"
```

Linux:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.chrome-debug-profile"
```

Windows PowerShell:

```powershell
.\start-chrome.ps1
```

Or start it manually:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:USERPROFILE\.chrome-debug-profile"
```

Then open the dashboard in that window and log in normally. Verify the port:

```bash
curl http://127.0.0.1:9222/json/version
```

Security notes:

- The CDP port grants full control of the browser. Keep it bound to `127.0.0.1` (the default) and never expose port 9222 to a network.
- Prefer the dedicated profile above so automation is isolated from your everyday Chrome data.
- If you use your default profile instead, close every Chrome window first and still pass `--user-data-dir` on Chrome 136+.

## 2. Install and run

```bash
cd /path/to/New_Automations_for_Upwork
chmod +x run.sh
./run.sh
```

`run.sh` installs `puppeteer-core` on the first run if it is missing. You can also run it directly:

```bash
npm install
npm start
```

On Windows, start Chrome with `.\start-chrome.ps1`, log in once in the new window, then run:

```powershell
.\run.ps1
```

## 3. Configuration

All settings are environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_URL` | `https://www.upwork.com/nx/find-work/` | Page to keep refreshed |
| `CDP_URL` | `http://127.0.0.1:9222` | Chrome remote-debugging endpoint |
| `MIN_MINUTES` | `4` | Minimum interval between refreshes |
| `MAX_MINUTES` | `9` | Maximum interval between refreshes |
| `RELOAD_TIMEOUT_MS` | `60000` | Timeout for navigation/reload |
| `RECONNECT_DELAY_MS` | `15000` | Wait before reconnecting to Chrome |
| `MAX_RECONNECT_ATTEMPTS` | `0` | `0` = retry forever |
| `LOGIN_WAIT_MINUTES` | `10` | How long to wait for manual login before refreshing again |
| `FOCUS_TAB` | `false` | Bring the dashboard tab to the foreground on each refresh |

Example:

```bash
DASHBOARD_URL="https://www.upwork.com/nx/find-work/" \
MIN_MINUTES=4 \
MAX_MINUTES=9 \
./run.sh
```

## Troubleshooting

- `ECONNREFUSED` or "Could not reach Chrome": Chrome is not running with the debugging port, or `CDP_URL` points to the wrong host/port.
- Login screen after a refresh: log in once in the debug profile; the session is stored there.
- Chrome 136+: the `--user-data-dir` flag is mandatory for remote debugging.
- Multiple Chrome installations: use the full path to the correct binary.
- The tab was closed: the script opens a new dashboard tab automatically.

## Disclaimer

This tool is intended for keeping your own logged-in dashboard session alive. Automating a website may violate its Terms of Service: Upwork and similar platforms restrict bots, automated activity, and artificial activity or availability signals. Randomized timing does not make automation compliant and does not guarantee that it will go unnoticed. You are responsible for complying with the platform's ToS, rate limits, and applicable laws. Keep intervals conservative, do not run multiple instances against the same account, and stop if the platform objects. The authors accept no liability for account restrictions or other consequences.
