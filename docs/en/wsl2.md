# Windows via WSL2
<!-- de: 8a7e1543f89a -->

On Windows, the kit runs in WSL2, the Linux that Windows ships with, and works there as on macOS and Linux. This guide takes you from a fresh Windows machine to the first `/session-start` and the first green `/local-check`.

## Prerequisites
<!-- de: 7857e23a7c8e -->

- **Windows 11, Home or Pro.** Windows 10 may work, but it is not the starting point.
- **Virtualization enabled.** In the Task Manager under Performance → CPU it says "Virtualization: Enabled". Otherwise it is switched on in the BIOS or UEFI.
- **Administrator rights** for the setup. Afterwards you work as a normal user.

## Steps
<!-- de: d9ae308347ed -->

1. **Enable WSL2.** In PowerShell as administrator (right-click on Start → "Terminal (Admin)"):

   ```powershell
   wsl --install
   ```

   This enables WSL2 and downloads Ubuntu. Restart when Windows asks you to.

   Done when `wsl --status` in PowerShell reports `2` as the default version.

2. **Set up Ubuntu.** After the restart Ubuntu opens; otherwise start it from the Start menu. You create a Linux user with a password, independent of the Windows account, and bring the system up to date:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Done when `wsl -l -v` in PowerShell shows `Ubuntu` with `VERSION` `2` and the Ubuntu terminal offers a prompt like `<name>@<rechner>:~$`.

3. **Install the tools**, all in the Ubuntu terminal:

   - git: `sudo apt install -y git`
   - Node.js version 18 or later, for example via [nvm](https://github.com/nvm-sh/nvm) with `nvm install --lts`; the `nodejs` package from `apt` is older depending on the Ubuntu version.
   - Claude Code following the [installation guide](https://claude.ai/code) for Linux.
   - Depending on the issue tracker `gh` or `glab`, then `gh auth login` or `glab auth login`. In local mode neither.

   Done when `git --version`, `node --version` (at least `v18`) and `claude --version` each print a version and `gh auth status` or `glab auth status` confirms the login.

4. **Create or clone the project in the Linux file system**, under `~/`, not under `/mnt/c` (see [Where the project lives](#where-the-project-lives)):

   ```bash
   cd ~
   git clone <adresse-deines-repos> mein-projekt
   cd mein-projekt
   ```

   A new project: `mkdir ~/mein-projekt && cd ~/mein-projekt && git init`.

   Done when `pwd` prints a path under `/home/<name>/` and `git status` answers without an error.

5. **Install the kit**, in the project folder:

   ```bash
   curl -O https://docs.mwolff.org/install.mjs
   node install.mjs
   ```

   The installer's questions are explained in the [5-minute guide](/en/quickstart#installing).

   Done when `ls .claude/kit` shows `board.mjs` and `.claude/workflow.config.json` exists.

6. **Start Claude Code**, in one of two ways:

   - **Terminal:** call `claude` in the project folder in the Ubuntu terminal.
   - **Claude desktop app on Windows:** choose WSL or Ubuntu as the working environment and the project under `/home/<name>/` as the folder.

   Then, in the session:

   ```
   /session-start
   /local-check
   ```

   Done when `/session-start` prints the project status and `/local-check` ends with a green checklist. In the desktop app you also have `uname -s` run; the answer is `Linux`.

## Where the project lives
<!-- de: 7f58b01befe4 -->

The project lives under `/home/<name>/`, **not** on the Windows drive under `/mnt/c`:

- **Speed.** Access to `/mnt/c` goes through a bridge to Windows; check runs (Prüfläufe), git and tests take many times as long there.
- **File permissions and line endings** follow the rules of Windows there. Scripts lose their execute permission, line endings change unnoticed.
- **The kit's check runs require POSIX file permissions** and fail there for the wrong reason.

## Working with Windows tools
<!-- de: 254285cff935 -->

- **File Explorer.** The Linux home directory is under `\\wsl$\Ubuntu\home\<name>`; `explorer.exe .` opens the current folder.
- **Editor.** VS Code with the "WSL" extension opens the project directly in WSL2 with `code .`.

Both ways leave the files where they are. Do not copy the project to the Windows drive.

## Moving from native Windows
<!-- de: 2babc2339ca7 -->

Native Windows and Git Bash are no longer supported as of 4.0.0. If you have used the kit there so far, move like this:

1. Set up WSL2 following [steps](#steps) 1 to 3.
2. Clone the project from its repository anew into `~/` (step 4) instead of copying the folder. Push any commits not yet pushed beforehand on Windows.
3. Install the kit anew in WSL2 (step 5).
4. Do not keep using the old `.claude/` copy on Windows; the installation in WSL2 creates its own.

Then start Claude Code as in step 6.
