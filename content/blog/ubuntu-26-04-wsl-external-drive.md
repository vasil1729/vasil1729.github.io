+++
title = "A Linux Environment You Can Unplug: Ubuntu 26.04 on an External Drive with WSL 2"
description = "Why I installed Ubuntu 26.04 LTS as a separate WSL 2 distribution on an external NTFS drive — keeping the virtual disk off the Windows system drive, preserving my existing distros, and the portability, backup, and failure modes that come with it."
date = 2026-10-27

[taxonomies]
tags = ["wsl", "ubuntu", "windows", "linux", "storage", "virtualization"]

[extra]
canonical = ""
+++

WSL makes it possible to run a Linux environment directly on Windows without a traditional dual boot or manually managing a virtual machine. It is the least dramatic way to get a real Ubuntu shell on a Windows machine — and for most people, it is enough.

By default, though, every WSL distribution lives on the Windows system drive. That is fine until you have several of them, a development workload that keeps growing, and a `C:` partition that was sized for Windows and not for a pile of Linux virtual disks. It also means the Linux environment shares a fate with the Windows installation: reset Windows, and the distros go with it.

I wanted something slightly different. I already had Ubuntu 24.04, Ubuntu 22.04, and Debian registered. I wanted Ubuntu 26.04 LTS as a separate installation, living on an external NTFS drive, without disturbing any of the existing environments. This is how I did it, why it is useful, and what to watch out for.

## Why Put Linux on an External Drive?

The obvious reason is disk space, but that is only the start. A separate external drive changes the operational properties of the environment:

- **It keeps the Windows system drive lean.** WSL distributions are stored as dynamically growing virtual disks. Node modules, container images, language toolchains, and build caches can push a distro into tens of gigabytes. Moving that growth to `D:` keeps `C:` from becoming the bottleneck during Windows updates or ordinary use.
- **It creates an isolated environment.** Ubuntu 26.04 does not share packages, configuration, or home directory with Ubuntu 24.04. I can break it, reset it, or unregister it without touching my daily driver.
- **It makes release testing cheap.** A new Ubuntu LTS can be installed, used, and evaluated on the external drive while the existing environments stay exactly as they were. If 26.04 turns out to be a bad fit, delete it; no rollback planning required.
- **It gives you a backup and cloning story.** With WSL shut down, the distribution is just an `ext4.vhdx` file. Copy it, archive it, or clone it before doing something destructive. That is far simpler than imaging a partition or snapshotting a dual-boot setup.
- **It is portable, with an important caveat.** The drive can move between machines. WSL's *registration* — the list of installed distributions — lives in Windows, not on the drive. On another machine you register the virtual disk with `wsl --import` (or perform a fresh install). It is not plug-and-play, but the environment itself travels.
- **It avoids the risks of dual boot.** No repartitioning, no bootloader changes, no shrinking the Windows partition. Windows remains the primary OS; Linux is a process tree that starts when asked.

The trade-off is that the external drive becomes part of the environment's availability. If it is a slow spinning disk, a loose USB connection, or a drive you unplug without shutting WSL down, this setup will be worse than the default. I have hit that exact failure mode before — journal recovery, slow boots, and orphaned files: [A Loose Cable, a Slow WSL Boot, and a Shell That Kept Losing My PATH](@/blog/wsl-external-disk-slow-zsh-startup.md). For a machine that travels or a drive that disconnects, keep the distro on internal storage.

## Why WSL 2, and How the External Disk Fits

WSL 2 runs a real Linux kernel inside a lightweight virtual machine managed by Windows. Unlike WSL 1, which translated Linux system calls into Windows calls, WSL 2 provides full syscall compatibility and a real ext4 filesystem. That matters for Docker, package managers, file watchers, and anything that expects Linux semantics rather than a compatibility layer.

The important detail is what is actually stored on the external drive. The drive is NTFS; the Linux filesystem lives inside an `ext4.vhdx` virtual disk file. WSL mounts that VHDX and exposes it to the Linux kernel. The external drive is not mounted into Ubuntu as its root filesystem — it holds the virtual disk that contains the filesystem.

This distinction has practical consequences:

- **The drive must be NTFS.** WSL's virtual disk relies on features that exFAT and FAT32 do not provide. Do not format the drive as exFAT hoping to share files more easily; that is what a separate data partition is for.
- **The drive letter must stay stable.** WSL remembers the installation path. If Windows reassigns `D:` to `E:`, the distribution will not start. Assign a permanent letter in Disk Management.
- **Keep Linux files inside the VHDX.** Accessing project files through Windows-mounted paths (`/mnt/d/...`) crosses the VM boundary and is noticeably slower. Keep source trees and toolchains inside Ubuntu's own filesystem.

## The Setup

### Step 1: Prepare the external drive

I used an external hard drive connected to Windows and assigned the drive letter `D:`. It was formatted as NTFS and had enough free space for Ubuntu and future development work.

Before proceeding, confirm the drive is accessible in File Explorer and that important data is backed up. Formatting erases the drive, and a drive that disconnects mid-write can corrupt the VHDX. If the volume is BitLocker-encrypted, unlock it before starting WSL.

I chose this directory for the new distribution:

```text
D:\WSL\Ubuntu-26.04
```

Keeping WSL installations in their own folder makes them easy to find, back up, and remove later.

### Step 2: Check the existing installation

Before installing anything, I listed the distributions already registered with WSL:

```powershell
wsl --list --verbose
```

This shows each distribution, its state, and the WSL version it uses. On my system, Ubuntu 24.04, Ubuntu 22.04, and Debian were already present. I wanted Ubuntu 26.04 to be an additional installation, not a replacement.

I also checked the available installation options:

```powershell
wsl --help
```

The two that matter for this process are `--location`, which specifies the installation directory, and `--version 2`, which selects WSL 2.

If `--location` is not listed, the installed WSL build is too old:

```powershell
wsl --update
```

### Step 3: Install Ubuntu 26.04 on the external drive

From PowerShell:

```powershell
wsl --install Ubuntu-26.04 --location "D:\WSL\Ubuntu-26.04" --version 2
```

This installs Ubuntu 26.04 using WSL 2 and places its files in the specified directory instead of the default location on the system drive.

During the initial setup, Ubuntu prompts for a Linux username and password. These credentials belong to the Linux environment and are separate from the Windows account.

Once setup completes, the new distribution is ready to launch.

### Step 4: Verify the installation

Check the registered distributions again:

```powershell
wsl --list --verbose
```

Ubuntu 26.04 should appear with WSL version 2, and the existing distributions should remain registered.

Next, confirm where the files actually landed:

```powershell
Get-ChildItem "D:\WSL\Ubuntu-26.04"
```

The directory contains the distribution's virtual disk, `ext4.vhdx`. That file is the entire Linux filesystem. Windows still manages and runs the distribution through WSL's normal virtualization layer; the external drive only stores the disk.

From inside Ubuntu, verify the environment:

```bash
whoami
lsb_release -a
```

These display the Linux username and the installed Ubuntu release. My installation reported Ubuntu 26.04.1 LTS. If `lsb_release` is not installed, `cat /etc/os-release` shows the same release information.

### Step 5: Launch and shut down cleanly

Launch the new distribution from PowerShell by name:

```powershell
wsl -d Ubuntu-26.04
```

The Ubuntu application entry created during installation also works.

To stop every running WSL distribution:

```powershell
wsl --shutdown
```

This stops the WSL virtual machine and its distributions. Ubuntu can be started again when needed.

## What This Setup Buys You

The benefits are not theoretical. They show up in day-to-day use:

| Benefit | What it means in practice |
|---|---|
| **System drive stays small** | The growing `ext4.vhdx` lives on `D:`, not `C:`. Windows updates and the rest of the system keep their headroom. |
| **Clean isolation** | A buggy toolchain, a bad upgrade, or a destroyed home directory affects only this distribution. |
| **Cheap resets** | Unregister and reinstall Ubuntu 26.04 without touching Windows or the other distros. |
| **Safe release testing** | Try a new LTS for real work while the stable environment stays untouched. |
| **Simple backups** | Shut down WSL, copy `ext4.vhdx` (or run `wsl --export`), and you have a complete snapshot. |
| **Physical portability** | Carry the drive to another Windows machine and register the disk there, rather than rebuilding the environment by hand. |

The last point deserves a caveat: this is not a bootable Linux installation. The drive holds a virtual disk, not a full operating system that can boot on its own. If you need Linux on bare metal, use a real installation; if you need a portable development environment that runs under Windows, this is a good fit.

## The Trade-offs

The external drive is now a dependency:

- **The drive must be connected.** While Ubuntu is running, removing the drive can corrupt the virtual disk. Shut down WSL first.
- **Disconnect only after `wsl --shutdown`.** Wait for WSL to stop before unplugging the drive. Pulling it during a write risks filesystem and virtual-disk damage.
- **USB performance is not NVMe performance.** A USB 3 SSD is fine for most development. A spinning external HDD is usable but slow, especially for cold starts and large builds.
- **Cables, enclosures, and hubs matter.** A flaky connection is not a minor annoyance here; it is a data-integrity problem.
- **Backups are still your responsibility.** Storing Ubuntu on an external drive does not back it up. Keep copies of important files, and do not unregister a distribution unless you intend to remove its data.
- **A missing drive looks like a broken distro.** `wsl --list --verbose` still lists it, but launching fails until the drive is reconnected with the same letter. Do not unregister it in a panic.

If the environment must always be available — a laptop that moves between desks, a drive shared with other machines, a machine where USB disconnects happen — internal storage is the better default. The external drive is a deliberate trade: space, isolation, and portability in exchange for a physical dependency.

## The Lesson

- **A WSL distribution is a virtual disk, not a folder of loose files.** Once that is clear, moving it, backing it up, and reasoning about failure modes all become easier.
- **`--location` is the whole trick.** It turns a system-drive default into an explicit placement decision.
- **Isolation is the real feature.** The disk space is nice; being able to test Ubuntu 26.04 without risking the daily environment is what makes the setup worth it.
- **Clean shutdowns are not optional.** External storage makes an unclean unmount more likely, and an unclean unmount costs journal recovery or worse.
- **Verify the target before destructive operations.** The same habit from disk formatting applies here: know which drive and which distribution you are working with before deleting or moving anything.

The result is a dedicated Ubuntu 26.04 environment whose virtual disk lives on the external drive, while Windows and the existing WSL distributions remain intact. The drive is essential to the environment's availability — keep it connected while Ubuntu is running, shut WSL down before disconnecting, and maintain backups of anything important.

**Official reference:** [Microsoft Learn — Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install)

## Commands Reference

```powershell
# What is already installed, and on which WSL version?
wsl --list --verbose

# Update WSL if --location is not available
wsl --update

# Install Ubuntu 26.04 to a custom location on the external drive
wsl --install Ubuntu-26.04 --location "D:\WSL\Ubuntu-26.04" --version 2

# Confirm the virtual disk landed where expected
Get-ChildItem "D:\WSL\Ubuntu-26.04"

# Launch the distribution by name
wsl -d Ubuntu-26.04

# Stop all WSL distributions before unplugging the drive
wsl --shutdown

# Alternative: move an existing distribution to the external drive
wsl --manage Ubuntu-26.04 --move "D:\WSL\Ubuntu-26.04"
```

```bash
# Inside Ubuntu: confirm the user and release
whoami
lsb_release -a
cat /etc/os-release   # fallback if lsb_release is unavailable

# Confirm the root filesystem is the external VHDX
df -h /
```
