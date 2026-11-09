#!/usr/bin/env bash
# Stand up a k3d cluster running Scooter with the replay agent (`.#cluster`).
# Needs k3d, kubectl and curl. In a Scooter sandbox, use its k3d (not the dev
# shell's) inside dockerd's network: `docker-netns lib/cluster-up.sh`.
set -euo pipefail
cd "$(dirname "$0")/.."

cluster=$(nix build .#cluster --no-link --print-out-paths)
ns=agent-sandbox

if ! k3d registry list 2>/dev/null | grep -qE '^k3d-scooter-reg\.localhost([[:space:]]|$)'; then
  k3d registry create scooter-reg.localhost --port 5800
fi
if ! k3d cluster list 2>/dev/null | grep -qE '^scooter-demos([[:space:]]|$)'; then
  k3d cluster create scooter-demos --no-lb --wait --registry-use k3d-scooter-reg.localhost:5800
fi
k3d kubeconfig merge scooter-demos --kubeconfig-merge-default --kubeconfig-switch-context >/dev/null

until curl -sf http://localhost:5800/v2/ >/dev/null; do sleep 2; done

# The Sandbox CRD and controller, the version Scooter's CI installs.
base=https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v0.5.2
kubectl apply -f "$base/sandbox.yaml" -f "$base/extensions.yaml"
kubectl wait --for=condition=Available deploy --all -n agent-sandbox-system --timeout=180s

"$cluster/bin/push-images"

kubectl apply -f "$cluster/platform.yaml"
for s in agent-conv-token-secret agent-remote-join-secret; do
  kubectl -n "$ns" create secret generic "$s" \
    --from-literal=secret="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')" \
    --dry-run=client -o yaml | kubectl apply -f -
done
kubectl -n "$ns" rollout status deployment/agent-shared-db --timeout=180s
kubectl -n "$ns" wait --for=condition=complete job -l app.kubernetes.io/name=agent-db-migrate --timeout=300s
for d in conversation-controller agent-host conversation-router ui; do
  kubectl -n "$ns" rollout status "deployment/$d" --timeout=300s
done
echo "cluster ready"
