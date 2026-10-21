{{- define "kara.namespace" -}}
{{- .Values.namespace.name | default .Release.Namespace -}}
{{- end -}}

{{- define "kara.labels" -}}
app.kubernetes.io/part-of: simorgh-kara
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{- define "kara.image" -}}
{{- printf "%s/%s:%s" .root.Values.registry.host .repo .root.Values.image.tag -}}
{{- end -}}

{{- define "kara.imagePullSecrets" -}}
{{- if .Values.registry.pullSecret }}
imagePullSecrets:
  - name: {{ .Values.registry.pullSecret }}
{{- end }}
{{- end -}}

{{- define "kara.podSecurity" -}}
runAsNonRoot: true
seccompProfile: { type: RuntimeDefault }
{{- end -}}

{{- define "kara.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: { drop: [ALL] }
{{- end -}}

{{/* DATABASE_URL from the kara-db Secret ($(…) expands the two variables before it). */}}
{{- define "kara.dbEnv" -}}
- name: DB_USER
  valueFrom:
    secretKeyRef: { name: {{ .Values.postgresql.existingSecret }}, key: username }
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef: { name: {{ .Values.postgresql.existingSecret }}, key: password }
- name: DATABASE_URL
  value: {{ printf "postgres://$(DB_USER):$(DB_PASSWORD)@kara-postgresql:5432/%s" .Values.postgresql.database | quote }}
{{- end -}}
