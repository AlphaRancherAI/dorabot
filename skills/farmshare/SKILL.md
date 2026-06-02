---
name: farmshare
description: "Run commands on Stanford FarmShare via SSH, manage SLURM jobs (submit, monitor, cancel), and check GPU training status. Handles SSH multiplexing, tcsh workarounds, and Kerberos auth. Also handles rsync/scp to Stanford AFS and any SSH connection to rice/stanford.edu."
triggers:
  - farmshare
  - rice
  - stanford ssh
  - kerberos
  - kinit
  - AFS
  - stanford.edu ssh
  - rsync stanford
  - scp stanford
  - slurm
  - sbatch
  - squeue
---

# FarmShare Skill

Run commands on Stanford FarmShare (rice login nodes, oat/barley/rye/wheat compute nodes) via SSH. Handles SSH multiplexing into existing connections, SLURM job management, GPU training workflows, and file transfers (rsync/scp) to Stanford AFS.

**Use this skill any time you need to SSH, rsync, or scp to anything at stanford.edu.** This includes deploying to AFS (web.stanford.edu), running commands on rice, or transferring files. The ControlMaster socket avoids Kerberos auth issues.

## SSH Connection

### Multiplexing (preferred)

Henry keeps a ControlMaster SSH socket open. Always try the socket first before attempting a fresh connection.

```bash
# Socket location
/Users/henry/.ssh/sockets/hankliao@rice-01.farmshare.stanford.edu-22

# Check if socket is alive
ssh -O check -S /Users/henry/.ssh/sockets/hankliao@rice-01.farmshare.stanford.edu-22 hankliao@rice-01.farmshare.stanford.edu 2>&1

# Use the socket (instant, no auth needed)
ssh -S /Users/henry/.ssh/sockets/hankliao@rice-01.farmshare.stanford.edu-22 hankliao@rice-01.farmshare.stanford.edu '<command>'
```

The socket path may vary by rice node (rice-01, rice-02, etc.). Check what's available:

```bash
ls /Users/henry/.ssh/sockets/hankliao@rice*
```

### Fresh connection (fallback)

Requires active Kerberos ticket. Will fail with "Permission denied" if ticket is expired.

```bash
ssh hankliao@rice.stanford.edu '<command>'
```

If auth fails, ask the user to SSH in manually to re-establish the socket.

### File transfers (rsync/scp to AFS)

Always use the ControlMaster socket for rsync and scp. Never attempt bare `rsync hankliao@rice.stanford.edu:...` without the socket, it will fail if Kerberos is expired.

```bash
# Find active socket
SOCKET=$(ls /Users/henry/.ssh/sockets/hankliao@rice*.farmshare.stanford.edu-22 2>/dev/null | head -1)

# rsync to AFS (e.g., deploying dashboard)
rsync -avz --delete -e "ssh -S $SOCKET" ./out/ hankliao@rice-01.farmshare.stanford.edu:/afs/ir/users/h/a/hankliao/WWW/bmds210/dashboard/

# scp a file
scp -o "ControlPath=$SOCKET" localfile.txt hankliao@rice-01.farmshare.stanford.edu:~/destination/
```

The hostname in the rsync/scp command must match the socket (e.g., `rice-01.farmshare.stanford.edu`, not `rice.stanford.edu`).

### Critical: tcsh workaround

FarmShare's default shell is **tcsh**, which mangles bash syntax (variable names, heredocs, arrays). ALWAYS pipe commands through bash:

```bash
cat << 'SCRIPT' | ssh -S /Users/henry/.ssh/sockets/hankliao@rice-01.farmshare.stanford.edu-22 hankliao@rice-01.farmshare.stanford.edu 'bash -s'
# Your bash commands here
echo "This runs in bash, not tcsh"
SCRIPT
```

**Never** pass complex commands directly as SSH arguments. They will break in tcsh.

## SLURM Commands

### Check queue

```bash
# All user jobs
squeue -u hankliao -o "%.10i %.20j %.8T %.10M %.6D %.4C %.10m %R"

# Specific job
squeue -j <job_id>

# Detailed job info
scontrol show job <job_id>
```

### Submit jobs

```bash
# Submit a SLURM script
sbatch /path/to/script.slurm

# Submit with argument (e.g., fold number)
sbatch /path/to/script.slurm 2

# Submit all 5 folds
for f in 0 1 2 3 4; do sbatch /path/to/script.slurm $f; done
```

### Cancel jobs

```bash
# Cancel one job
scancel <job_id>

# Cancel all user jobs
scancel -u hankliao

# Cancel by job name
scancel --name=mednext_v2_f1
```

### Job history

```bash
# Recent completed jobs
sacct -u hankliao --starttime=2026-05-20 --format=JobID,JobName,State,Elapsed,ExitCode,NodeList
```

## GPU Cluster Details

| Node type | Count | GPUs | Use |
|-----------|-------|------|-----|
| oat-01..06 | 6 (3 usable, oat-04 drained, oat-05/06 inval) | 4x NVIDIA L40S (48 GB) each | GPU jobs |
| barley/rye/wheat | CPU nodes | none | CPU jobs |

### GPU QoS

```bash
#SBATCH --partition=gpu
#SBATCH --qos=gpu
#SBATCH --gpus=1
```

**Always set `--qos=gpu`** for GPU jobs. Without it, jobs default to `normal` QoS with much lower priority (2.1B vs 4.3B max). Open OnDemand submissions often miss this flag.

### Resource constraints

- Each GPU job requesting 192G RAM causes SLURM to allocate ~50 CPUs (192G / ~4G per CPU on oat nodes)
- Max 4 concurrent GPU jobs per user, max 4 GPUs per user
- 48h wall time limit per job

### CUDA

```bash
module load cuda/12.9.0
# CUDA_HOME=/software/spack/opt/spack/linux-x86_64_v3/cuda-12.9.0-jmleofbt4f2ctfltnzfkgly2quee5d6y
```

## Monitoring Training Jobs

### Check training progress

nnU-Net/MedNeXt writes epoch progress to training log files, not stdout. Check both:

```bash
# SLURM stdout log (job info, config, completion messages)
tail -50 ~/bmds260/logs/mednext_v2_<job_id>.out

# nnU-Net training log (epoch-by-epoch progress, Dice scores)
tail -10 ~/bmds260/nnunet/results/nnUNet/3d_fullres/<TaskDir>/<Trainer>__<Plans>/fold_<N>/training_log_*.txt

# Find the latest training log for a fold
ls -t ~/bmds260/nnunet/results/nnUNet/3d_fullres/Task501_BraTSGLI_v2/nnUNetTrainerV2_MedNeXt_B_kernel5__nnUNetPlansv2.1/fold_<N>/training_log_*.txt | head -1
```

### Check validation predictions

When training completes (1000 epochs), nnU-Net writes validation predictions:

```bash
ls ~/bmds260/nnunet/results/nnUNet/3d_fullres/Task501_BraTSGLI_v2/nnUNetTrainerV2_MedNeXt_B_kernel5__nnUNetPlansv2.1/fold_<N>/validation_raw/*.nii.gz | wc -l
# Should be 292 (or 291) for v2 dataset
```

### Full status check template

```bash
cat << 'SCRIPT' | ssh -S <SOCKET> hankliao@rice-01.farmshare.stanford.edu 'bash -s'
echo "=== SLURM Queue ==="
squeue -u hankliao -o "%.10i %.20j %.8T %.10M %.6D %.4C %.10m %R"

echo ""
echo "=== Training Progress ==="
BASE=~/bmds260/nnunet/results/nnUNet/3d_fullres/Task501_BraTSGLI_v2/nnUNetTrainerV2_MedNeXt_B_kernel5__nnUNetPlansv2.1
for f in 0 1 2 3 4; do
  log=$(ls -t "$BASE/fold_$f"/training_log_*.txt 2>/dev/null | head -1)
  if [ -n "$log" ]; then
    epoch=$(grep "^epoch:" "$log" | tail -1)
    echo "Fold $f: $epoch"
  else
    echo "Fold $f: no training log"
  fi
done

echo ""
echo "=== Validation Predictions ==="
for f in 0 1 2 3 4; do
  dir="$BASE/fold_$f/validation_raw"
  if [ -d "$dir" ]; then
    count=$(ls "$dir"/*.nii.gz 2>/dev/null | wc -l)
    echo "Fold $f: $count predictions"
  else
    echo "Fold $f: not yet generated"
  fi
done
SCRIPT
```

## Evaluation (CPU-only, runs on login node)

Lesion-wise Dice evaluation does NOT need a GPU. Run directly on the rice login node:

```bash
# Single fold (nnU-Net shortcut)
python3 ~/bmds260/eval_lesion_dice.py --task 501 --fold 0 -o ~/bmds260/fold0_lesion_dice_v2.json

# Generic (any pred/gt dirs)
python3 ~/bmds260/eval_lesion_dice.py --pred-dir /path/to/preds --gt-dir /path/to/gt -o results.json

# Run in background on login node (takes ~45 min for 292 cases)
nohup python3 ~/bmds260/eval_lesion_dice.py --task 501 --fold 0 -o ~/bmds260/fold0_lesion_dice_v2.json > ~/bmds260/eval_fold0.log 2>&1 &
```

## Holdout Inference

After all folds complete, run ensemble inference on the 162 holdout cases:

```bash
export nnUNet_raw_data_base=~/bmds260/nnunet/raw_data_base
export nnUNet_preprocessed=~/bmds260/nnunet/preprocessed
export RESULTS_FOLDER=~/bmds260/nnunet/results

nnUNetv2_predict \
  -i $nnUNet_raw_data_base/nnUNet_raw_data/Task501_BraTSGLI_v2/imagesTs \
  -o ~/bmds260/holdout_predictions \
  -tr nnUNetTrainerV2_MedNeXt_B_kernel5 \
  -t 501 -m 3d_fullres -f 0 1 2 3 4
```

This requires a GPU. Submit as a SLURM job.

## Common Pitfalls

1. **Missing `-c` flag for resume**: `mednextv1_train` without `-c` restarts from epoch 0 and OVERWRITES existing checkpoints. Always include `-c` when resuming.
2. **tcsh mangling**: Never pass bash syntax directly as SSH args. Always pipe through `bash -s`.
3. **Kerberos expiry**: SSH sockets outlive Kerberos tickets. If the socket dies, the user needs to `kinit` and reconnect.
4. **QoS priority**: GPU jobs without `--qos=gpu` get deprioritized. Always set both `--partition=gpu` and `--qos=gpu`.
5. **48h wall time**: Long training jobs (MedNeXt 1000 epochs takes ~60-70h) will time out. Must resume with `-c` flag.
6. **Node availability**: Only oat-01, oat-02, oat-03 are consistently available. oat-04 is drained, oat-05/06 in inval state.

## Paths

| What | Path |
|------|------|
| nnU-Net raw data | `~/bmds260/nnunet/raw_data_base/` |
| nnU-Net preprocessed | `~/bmds260/nnunet/preprocessed/` |
| nnU-Net results | `~/bmds260/nnunet/results/` |
| SLURM logs | `~/bmds260/logs/` |
| Training script | `~/bmds260/train_mednext_v2.slurm` |
| Eval script | `~/bmds260/eval_lesion_dice.py` |
| Holdout GT | `~/bmds260/holdout_gt/` |
| Holdout images | `~/bmds260/nnunet/raw_data_base/nnUNet_raw_data/Task501_BraTSGLI_v2/imagesTs/` |
| SSH socket | `/Users/henry/.ssh/sockets/hankliao@rice-*.farmshare.stanford.edu-22` |

## Safety

- **Read-only operations are safe**: squeue, sacct, tail logs, ls, cat.
- **Job submission is safe**: sbatch, srun (won't damage anything, just uses compute).
- **Be careful with scancel**: confirm with user before cancelling jobs, especially if training has been running for hours/days.
- **Never delete model checkpoints** without explicit permission.
