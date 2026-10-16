# Windows via WSL2
<!-- de: 598bdd222ce9 -->

On Windows, the kit runs in WSL2, the Linux that Windows ships with. This guide takes you to a ready WSL2 and then back into [The first hour](/en/quickstart#_1-check-the-tools), where it continues for everyone.

## Prerequisites
<!-- de: aac4ac70d651 -->

- **Windows 11, Home or Pro.**
- **Administrator rights** for the setup.
- **Time:** about 20 to 40 minutes including the restart.

## Steps
<!-- de: 9b0ce1bb5cf0 -->

1. **Enable WSL2.** In PowerShell as administrator (right-click on Start → "Terminal (Admin)"):

   ```powershell
   wsl --install
   ```

   This enables WSL2 and downloads Ubuntu. Restart when Windows asks you to.

   Done when `wsl --status` in PowerShell reports `2` as the default version.

   Otherwise: If `wsl --install` reports an error about virtualization, it is switched off. To check: in the Task Manager under Performance → CPU it then says "Virtualization: Disabled". Your administrator or IT can enable it.

2. **Set up Ubuntu.** After the restart Ubuntu opens; otherwise start it from the Start menu. You create a Linux user with a password and bring the system up to date:

   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

   Done when `wsl -l -v` in PowerShell shows `Ubuntu` with `VERSION` `2` and the Ubuntu terminal offers a prompt like `<name>@<rechner>:~$`.

   Otherwise: If Ubuntu is missing from the list, run `wsl --install -d Ubuntu` in PowerShell.

WSL2 is now ready. Continue in the Ubuntu terminal with [step 1 of the first hour](/en/quickstart#_1-check-the-tools).

## On company computers
<!-- de: dd370ed809b8 -->

- **Blocked virtualization.** `wsl --install` fails as in step 1. Your administrator or IT can enable it.
- **Proxy.** Downloads in Ubuntu break off. The network team gives you the proxy address; enter it as `export HTTPS_PROXY=http://<proxy>:<port>` in `~/.bashrc`.
- **Company network certificates of its own.** `curl`, `npm` or `claude` report a certificate error. IT security hands out the root certificate; `export NODE_EXTRA_CA_CERTS=<pfad>` in `~/.bashrc` makes it known to Node.js and Claude Code.

## The runner on Windows
<!-- de: c177497d2cda -->

The runner runs in the Ubuntu terminal. Three things interrupt it:

- **Closed terminal.** The runner ends with the window. Keep it open.
- **The computer going to sleep.** A sleeping computer pauses WSL2. In the power options, set sleep on mains power to "Never".
- **WSL2 shutting down.** Windows shuts WSL2 down when idle, as soon as no terminal is open any more; `wsl --shutdown` ends it immediately. Do not run it while the runner is running.

## Where the project lives
<!-- de: 7f58b01befe4 -->

The project lives under `/home/<name>/`, **not** on the Windows drive under `/mnt/c`:

- **Speed.** Access to `/mnt/c` goes through a bridge to Windows; check runs (Prüfläufe), git and tests take many times as long there.
- **File permissions and line endings** follow the rules of Windows there. Scripts lose their execute permission, line endings change unnoticed.
- **The kit's check runs require POSIX file permissions** and fail there for the wrong reason.

## Working with Windows tools
<!-- de: c0378329394c -->

- **File Explorer.** The Linux home directory is under `\\wsl$\Ubuntu\home\<name>`; `explorer.exe .` opens the current folder.
- **Editor.** VS Code with the "WSL" extension opens the project directly in WSL2 with `code .`.
- **Claude desktop app.** Choose WSL or Ubuntu as the working environment and the project under `/home/<name>/` as the folder. `uname -s` answers `Linux` there.

All three leave the files where they are. Do not copy the project to the Windows drive.

## Moving from native Windows
<!-- de: 73205cbfea4e -->

Native Windows and Git Bash are no longer supported as of 4.0.0. If you have used the kit there so far, move like this:

1. Set up WSL2 following [steps](#steps) 1 and 2.
2. Install the tools as in [Check the tools](/en/quickstart#_1-check-the-tools).
3. Clone the project anew from its repository into `~/`, see [Create the project](/en/quickstart#_4-create-the-project), instead of copying the folder. Push unpushed commits beforehand on Windows.
4. Install the kit anew as in [Install the kit](/en/quickstart#_5-install-the-kit).
5. Do not keep using the old `.claude/` copy on Windows.

Claude Code is started in the project folder with `claude`, as in [Log in to Claude](/en/quickstart#_2-log-in-to-claude).
