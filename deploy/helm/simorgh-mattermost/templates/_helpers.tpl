{{- define "mm.namespace" -}}
{{- .Values.namespace.name | default .Release.Namespace -}}
{{- end -}}

{{- define "mm.labels" -}}
app.kubernetes.io/part-of: simorgh-team-platform
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{- define "mm.image" -}}
{{- printf "%s/%s:%s" .Values.registry.host .Values.image.repository .Values.image.tag -}}
{{- end -}}

{{- define "mm.pgImage" -}}
{{- printf "%s/%s:%s" .Values.registry.host .Values.postgresql.image.repository .Values.postgresql.image.tag -}}
{{- end -}}

{{- define "mm.imagePullSecrets" -}}
{{- if .Values.registry.pullSecret }}
imagePullSecrets:
  - name: {{ .Values.registry.pullSecret }}
{{- end }}
{{- end -}}
