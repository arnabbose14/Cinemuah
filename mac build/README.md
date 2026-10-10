# Cinemuah for macOS (.dmg)

A `.dmg` can only be produced on macOS, so it is built in one of two ways:

**GitHub Actions (no Mac needed)** — push the repo, open the *Actions* tab → *Build macOS DMG* → *Run workflow*.
When it finishes, download `Cinemuah-mac-arm64` (Apple Silicon) and/or `Cinemuah-mac-x64` (Intel) from the run's artifacts.

**On a Mac** — `./"mac build"/build-dmg.sh` (or `... x64` / `... arm64`). The result lands in `release-mac/`.

## First launch
The app is not code-signed (no Apple Developer account), so macOS blocks the first open:
right-click Cinemuah → Open → Open, or run `xattr -dr com.apple.quarantine /Applications/Cinemuah.app`.
