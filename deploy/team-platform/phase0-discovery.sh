#!/usr/bin/env bash
# Phase 0 of the Simorgh Team Platform (docs/TEAM-PLATFORM.md): look, change nothing.
#
#   bash deploy/team-platform/phase0-discovery.sh            # on the k8s master, as root
#   LLM_KEY=<key> bash deploy/team-platform/phase0-discovery.sh   # also list the models on llm.simorghai.com
#
# Read-only: kubectl get/describe, helm list, dig, curl GETs, df/du, nvidia-smi
# over ssh. No Secret is printed (only names). Output goes to /home (the big
# disk), one file per topic, plus a .tar.gz to send back.
set -u
OUT=${OUT:-/home/simorgh-discovery/$(date +%F-%H%M)}
mkdir -p "$OUT"

run() {  # run <file> <command…>  — never stops on an error
  local name=$1; shift
  printf '== %-18s' "$name"
  { echo "\$ $*"; timeout 60 "$@"; } >"$OUT/$name.txt" 2>&1
  echo " $(wc -l <"$OUT/$name.txt") lines"
}

run versions        sh -c 'kubectl version; helm version --short; head -3 /etc/os-release'
run nodes           kubectl get nodes -o wide --show-labels
run node-capacity   sh -c "kubectl describe nodes | grep -E '^Name:|^  cpu:|^  memory:|nvidia.com/gpu:|ephemeral-storage:|Taints:'"
run node-usage      kubectl top nodes
run namespaces      kubectl get ns
run helm-releases   helm list -A
run storageclasses  kubectl get storageclass
run pvcs            kubectl get pvc -A
run gateways        kubectl get gateway -A -o wide
run httproutes      kubectl get httproute -A
run lb-services     sh -c "kubectl get svc -A -o wide | awk 'NR==1 || /LoadBalancer/'"
run lb-pools        kubectl get ciliumloadbalancerippools -o yaml
run l2-policies     kubectl get ciliuml2announcementpolicies -o yaml
run netpols         kubectl get networkpolicy -A
run tls-secrets     sh -c "kubectl get secret -A --field-selector type=kubernetes.io/tls -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name"
run data-services   sh -c "kubectl get pods,svc -A -o wide | grep -iE 'postgres|redis|valkey|rabbit|minio|qdrant|kafka|rgw|mongo'"
run ai-services     sh -c "kubectl get pods,svc -A -o wide | grep -iE 'vllm|llm|embed|knowledge|qdrant|rerank'"
run vllm-models     sh -c "for ns in \$(kubectl get ns -o name | cut -d/ -f2); do kubectl -n \$ns get deploy,sts -o yaml 2>/dev/null | grep -E 'image: .*vllm|--model|served-model-name|max-model-len|gpu-memory-utilization' | sed \"s/^/\$ns: /\"; done"
run gpu-alloc       sh -c "kubectl get nodes -o custom-columns='NAME:.metadata.name,GPU:.status.allocatable.nvidia\\.com/gpu,PRODUCT:.metadata.labels.nvidia\\.com/gpu\\.product,MEM:.metadata.labels.nvidia\\.com/gpu\\.memory'"
run gpu-smi         sh -c 'for h in 192.168.1.61 192.168.1.62; do echo "## $h"; ssh -o BatchMode=yes -o ConnectTimeout=8 $h nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv; done'
if [ -n "${LLM_KEY:-}" ]; then
  run llm-models    sh -c 'curl -s https://llm.simorghai.com/v1/models -H "Authorization: Bearer $LLM_KEY"'
fi
run n8n             sh -c "kubectl -n n8n get deploy,sts,svc,pvc,gateway -o wide; kubectl -n n8n get deploy,sts -o jsonpath='{range .items[*]}{.metadata.name}{\"  \"}{..image}{\"\\n\"}{end}'"
run nextcloud       sh -c "kubectl get pods,svc,pvc -A | grep -iE 'nextcloud|collabora'"
run keycloak        sh -c "kubectl -n keycloak get pods,svc,gateway; curl -s https://auth.simorghai.com/realms/kara/.well-known/openid-configuration | head -c 400; echo"
run gitlab          sh -c "kubectl get pods,svc -A | grep -i gitlab; curl -s -o /dev/null -w 'gitlab %{http_code}\\n' https://gitlab.simorghai.com/gitlab/users/sign_in"
run dns             sh -c 'for h in plane team mm chat automation n8n cloud kara auth llm gitlab monitoring; do printf "%-11s " $h; dig +short $h.simorghai.com @192.168.1.68 | tr "\n" " "; echo; done'
run harbor          sh -c "curl -s -o /dev/null -w 'v2 %{http_code}\\n' https://registry.simorghai.com/v2/; curl -s 'https://registry.simorghai.com/api/v2.0/projects?page_size=50' | grep -o '\"name\":\"[^\"]*\"'"
run disk-master     sh -c 'df -h / /home; du -xsh /var/lib/containers /var/lib/containerd /var/log /root 2>/dev/null'

tar czf "$OUT.tar.gz" -C "$(dirname "$OUT")" "$(basename "$OUT")"
echo
echo "Done: $OUT  (send me $OUT.tar.gz, or paste the files you want checked)"
