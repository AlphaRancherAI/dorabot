---
name: leonardo
description: "SSH to the Leonardo 5090 GPU machine (Windows + WSL). Manage storage, run GPU workloads, access Windows and Linux environments. Tailscale-connected home cluster."
triggers:
  - leonardo
  - 5090
  - white
  - 100.115.74.117
  - wsl ssh
  - windows ssh
  - home gpu
  - home machine
  - 5090 machine
  - rtx 5090
---

# Leonardo Skill

SSH to Henry's home GPU machine (hostname: white, Tailscale IP: 100.115.74.117). NVIDIA RTX 5090 (32 GB VRAM). Runs Windows 11 with WSL2 (Ubuntu).

Two SSH entry points: WSL (Linux, port 22) and Windows (port 2222).

## SSH Connections

### WSL (Linux environment, port 22)

```bash
ssh doge@100.115.74.117
```

- Ubuntu on WSL2, bash shell
- GPU accessible via PyTorch (`torch.cuda.is_available()`)
- nvidia-smi at `/usr/lib/wsl/lib/nvidia-smi` (not in PATH)
- Python venv: `~/jupyter-env/` (Python 3.12, PyTorch CUDA 12.8, transformers, accelerate, peft, trl, bitsandbytes)
- HuggingFace cache: `~/.cache/huggingface/hub/`

### Windows (native environment, port 2222)

```bash
ssh -p 2222 doge@100.115.74.117
```

- Windows 11 (10.0.26200), PowerShell or cmd.exe
- User: `leonardo\doge` (admin group)
- Default shell: cmd.exe. For PowerShell: `powershell -Command "..."`
- Use this for managing Windows disk space, installed programs, and Windows-specific tasks
- sshd runs via scheduled task "OpenSSH-sshd" (runs at startup as SYSTEM)
- Config: `C:\ProgramData\ssh\sshd_config` (Port 2222)
- Log: `C:\ProgramData\ssh\logs\sshd.log`

### Auth

Both WSL and Windows accept the Mac's SSH key (ssh-rsa, henry@Henrys-MacBook-Pro.local).

Windows authorized_keys locations:
- `C:\Users\doge\.ssh\authorized_keys`
- `C:\ProgramData\ssh\administrators_authorized_keys`

### If Windows SSH is down

The sshd process (not the Windows service) is launched by scheduled task "OpenSSH-sshd" at boot. If it's not running:

1. SSH to WSL (port 22)
2. Start sshd via elevated PowerShell:
```bash
ssh doge@100.115.74.117 '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Start-Process powershell.exe -ArgumentList \"-Command Start-Process C:\Windows\System32\OpenSSH\sshd.exe -ArgumentList ''-E C:\ProgramData\ssh\logs\sshd.log'' -WindowStyle Hidden\" -Verb RunAs -WindowStyle Hidden"'
```
3. Wait 5 seconds, then test: `ssh -p 2222 doge@100.115.74.117 whoami`

Note: The Windows OpenSSH **service** (sshd) is broken/disabled. Do NOT try `Start-Service sshd`. The scheduled task + direct process launch is the working approach.

## JupyterLab

Start on WSL:
```bash
ssh doge@100.115.74.117 'source ~/jupyter-env/bin/activate && jupyter lab --ip=0.0.0.0 --port=8888 --no-browser'
```

SSH tunnel from Mac:
```bash
ssh -N -f -L 9010:localhost:8888 doge@100.115.74.117
```

Open: http://localhost:9010 (token: `ps3`)

## Disk Layout

Single drive: C: (931 GB total)

### Current usage (as of 2026-05-28)
| What | Size | Path |
|------|------|------|
| WSL VHDX | 450 GB | `C:\Users\doge\AppData\Local\wsl\{30d0fd8a-...}\ext4.vhdx` |
| Program Files (x86) | 42.7 GB | `C:\Program Files (x86)` |
| Downloads | 38.5 GB | `C:\Users\doge\Downloads` |
| Program Files | 38 GB | `C:\Program Files` |
| Windows | 35 GB | `C:\Windows` |
| stable-diffusion-webui | 16.4 GB | `C:\Users\doge\stable-diffusion-webui` |
| Temp | 8.5 GB | `C:\Users\doge\AppData\Local\Temp` |
| .cache | 8.3 GB | `C:\Users\doge\.cache` |
| SierraChart | 4.4 GB | `C:\SierraChart` |
| .lmstudio | 2.6 GB | `C:\Users\doge\.lmstudio` |
| Documents | 2.4 GB | `C:\Users\doge\Documents` |
| Free | ~15 GB | |

WSL ext4 filesystem inside VHDX: 1 TB virtual, 439 GB used, 518 GB free.

### Storage management rules
- **NEVER delete files without Henry's explicit permission.** Always list what you'd delete and get approval first.
- The WSL VHDX is the biggest target for reclaiming space, but shrinking it requires `wsl --shutdown` + `Optimize-VHD` (Hyper-V) or `diskpart` compact.
- Stale swap VHDXs in `C:\Users\doge\AppData\Local\Temp\*\swap.vhdx` (~8 GB total) are safe candidates to flag for cleanup.
- Downloads folder (38.5 GB) is worth auditing.

## Running PowerShell elevated from WSL

UAC ConsentPrompt is set to 0 (auto-elevate for admins), so `-Verb RunAs` works without a UAC prompt:

```bash
# From WSL:
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "Start-Process powershell.exe -ArgumentList '-Command <COMMANDS>' -Verb RunAs -WindowStyle Hidden"
```

Caveats:
- Don't use `-Wait` if the elevated process runs indefinitely (it blocks)
- Write output to files (`Out-File C:\Users\doge\result.txt`) and read back
- PowerShell interop from WSL does NOT have admin rights by default (UAC token filtering)

## File Transfer

```bash
# Mac to WSL
scp /local/file doge@100.115.74.117:/home/doge/

# WSL to Mac
scp doge@100.115.74.117:/home/doge/file /local/path/

# Mac to Windows (via port 2222)
scp -P 2222 /local/file doge@100.115.74.117:C:/Users/doge/

# Windows to Mac
scp -P 2222 doge@100.115.74.117:C:/Users/doge/file /local/path/
```

## Installed Software (Windows side)

- SierraChart (trading platform, 4.4 GB)
- LM Studio (2.6 GB, local LLM inference)
- stable-diffusion-webui (16.4 GB)
- thinkorswim (.thinkorswim, 0.1 GB)
- gminer (crypto mining)
- Superposition (benchmark)
- NVIDIA Ansel (screenshot tool)
- VS Code + VS Code Remote WSL
