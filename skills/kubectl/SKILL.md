---
name: kubectl
description: "Interact with Orion Kubernetes clusters (prod and staging). Use for checking deployments, pods, logs, and service status."
---

# kubectl Skill

Manage Orion's EKS clusters via kubectl.

## Clusters

Prod and staging are **separate EKS clusters** with separate kubectl contexts. They are NOT namespaces on the same cluster.

| Context | Cluster | Default Namespace |
|---------|---------|-------------------|
| `prod` | prod | prod |
| `staging` | staging | staging |

Current default context is `prod`.

## Usage

```bash
# Prod (default context)
kubectl get deployments -n prod

# Staging (must specify context)
kubectl --context=staging get deployments -n staging

# Switch context (avoid, prefer --context flag)
kubectl config use-context staging
```

Always use `--context=staging` explicitly rather than switching contexts, to avoid accidentally running commands against the wrong cluster.

## Flux GitOps

Both clusters use Flux to sync from the `master` branch of the kubernetes repo. Manual `kubectl set image` or `kubectl apply` will be overwritten by Flux within seconds.

- To deploy: edit the deployment YAML in the kubernetes repo, commit, push to master.
- Force reconcile: `kubectl annotate --overwrite kustomization/orion -n flux-system reconcile.fluxcd.io/requestedAt="$(date +%s)"`
- Flux kustomization name: `orion` in `flux-system` namespace.

## Common Operations

```bash
# List deployments with images
kubectl [--context=staging] get deployments -n <ns> -o custom-columns='NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,REPLICAS:.spec.replicas'

# Pod status
kubectl [--context=staging] get pods -n <ns>

# Logs
kubectl [--context=staging] logs -n <ns> deploy/<name> --tail=100

# Restart a deployment
kubectl [--context=staging] rollout restart -n <ns> deploy/<name>
```

## Deployment Rules

- **NEVER deploy to production without Henry's explicit permission.**
- Staging deploys are fine without asking.
- This applies to Kubernetes deployments, Docker image updates, database migrations, and any changes that touch prod infrastructure.
