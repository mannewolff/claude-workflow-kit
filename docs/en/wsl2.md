# Windows via WSL2
<!-- de: eefb0bdcb792 -->

On Windows, the kit runs in WSL2, the Linux that Windows itself ships with. There it works just as on macOS and Linux, without special paths. This guide takes you from a fresh Windows machine to the first session start with `/kontext` and the first green `/local-check`.

Native Windows and Git Bash are no longer supported as of 4.0.0.

## Prerequisites
<!-- de: 58e513d02bec -->

- **Windows 11, Home or Pro.** Windows 10 may work, but it is not the starting point of this guide.
- **Virtualization enabled.** You can check this in the Task Manager: Performance → CPU → "Virtualization: Enabled". If it says "Disabled", it has to be switched on in the machine's BIOS or UEFI.
- **Administrator rights** for setting up WSL2. Afterwards you work as a normal user.

## Steps
<!-- de: 622344e2f68c -->

1. **Enable WSL2.** Open PowerShell as administrator (right-click on Start → "Terminal (Admin)") and enter:

   ```powershell
   wsl --install
   ```

   The command enables WSL2 and downloads Ubuntu. Restart the machine afterwards if Windows asks you to.

   Done when `wsl --status` in PowerShell reports `2` as the default version.

2. **Set up Ubuntu.** After the restart, Ubuntu opens by itself; otherwise start it from the Start menu. On first start you create a Linux user name and a password; both are independent of your Windows account. Then bring the system up to date:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Done when `wsl -l -v` in PowerShell shows the line `Ubuntu` with `VERSION` `2` and the Ubuntu terminal offers a prompt like `<name>@<rechner>:~$` (`rechner` is the machine name).

3. **Install the tools.** All of the following commands run in the Ubuntu terminal, not in PowerShell.

   - git: `sudo apt install -y git`
   - Node.js version 18 or later: for example via [nvm](https://github.com/nvm-sh/nvm) with `nvm install --lts`. Depending on the Ubuntu version, the `nodejs` package from `apt` is older than 18.
   - Claude Code: following the [Claude Code installation guide](https://claude.ai/code) for Linux, in the Ubuntu terminal.
   - Depending on the issue tracker: `gh` (GitHub CLI) or `glab` (GitLab CLI), then `gh auth login` or `glab auth login`. In local mode you need neither.

   Done when `git --version`, `node --version` (at least `v18`) and `claude --version` each print a version in the Ubuntu terminal, and `gh auth status` for GitHub or `glab auth status` for GitLab confirms the login.

4. **Create or clone the project in the Linux file system.** The project lives under your Linux home directory `~/`, not under `/mnt/c` (why is explained under [Where the project lives](#where-the-project-lives)):

   ```bash
   cd ~
   git clone <adresse-deines-repos> mein-projekt
   cd mein-projekt
   ```

   For a new project instead: `mkdir ~/mein-projekt && cd ~/mein-projekt && git init`. (`<adresse-deines-repos>` is the address of your repository, `mein-projekt` is the project folder.)

   Done when `pwd` prints a path under `/home/<name>/` and `git status` answers without an error.

5. **Install the kit.** In the project folder, in the Ubuntu terminal:

   ```bash
   curl -O https://docs.mwolff.org/install.mjs
   node install.mjs
   ```

   The installer's questions are explained in the [5-minute guide](/en/quickstart#installing).

   Done when `.claude/workflow.config.json` and `.claude/kit/board.mjs` are in the project afterwards (`ls .claude/kit` shows `board.mjs`).

6. **Start Claude Code.** There are two ways, both work with the project in WSL2.

   - **Way A: terminal under WSL2.** In the Ubuntu terminal, call `claude` in the project folder.
   - **Way B: Claude desktop app on Windows.** The app runs on Windows, the session works with the project in WSL2: Choose WSL or Ubuntu as the working environment and the project under `/home/<name>/` as the folder.

   Then, in the session:

   ```
   /kontext
   /local-check
   ```

   Done when `/kontext` prints the project status and `/local-check` ends with a green checklist. With way B you also check that the session really works in WSL2: Ask Claude to run `uname -s` — the answer must be `Linux`.

## Where the project lives
<!-- de: de103583a149 -->

The project lives in the Linux file system under `~/`, that is under `/home/<name>/`, **not** on the Windows drive under `/mnt/c`. Three reasons:

- **Speed.** Access to `/mnt/c` goes through a bridge between Linux and Windows and is considerably slower. Check runs (Prüfläufe), git and tests that read many files take many times as long there.
- **File permissions and line endings.** Under `/mnt/c`, file permissions and line endings follow the rules of Windows, not those of Linux. Executable scripts lose their permission, and line endings change unnoticed.
- **The kit's check runs require POSIX file permissions.** On the Windows drive they are not reliable, and checks (Prüfungen) fail for the wrong reason.

## Working with Windows tools
<!-- de: c724d8899767 -->

The project stays in the Linux file system, and you can still reach it with Windows programs:

- **File Explorer.** In Explorer you reach your Linux home directory under `\\wsl$\Ubuntu\home\<name>`. It is quicker from the Ubuntu terminal: `explorer.exe .` opens the current folder in Explorer.
- **Editor.** VS Code with the "WSL" extension opens the project directly in WSL2: call `code .` in the project folder in the Ubuntu terminal. The editor runs on Windows; files, terminal and extensions work in WSL2.

Both ways leave the files where they are. Do not copy the project to the Windows drive to edit it there.

## Moving from native Windows
<!-- de: 1fa17b9eb6ae -->

If you have so far used the kit under native Windows or in Git Bash, you move like this:

1. Set up WSL2 following [steps](#steps) 1 to 3.
2. Clone the project from its repository afresh into `~/` (step 4), instead of copying the folder from the Windows drive or continuing to work under `/mnt/c`. Push any commits not yet pushed beforehand, under Windows.
3. Install the kit again in WSL2 (step 5).
4. Do not keep using the old `.claude/` copy under Windows. It belongs to the Windows installation; the new installation in WSL2 creates its own.

After that you start Claude Code as in step 6.
