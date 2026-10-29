# CI/CD Pipeline

## Flusso di Esecuzione

```
Push su master
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                     ci.yml (orchestratore)                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                     build.yml (reusable)                     │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                  │
│  │ detect  │───▶│  build  │───▶│ upload  │                  │
│  │         │    │ (matrix)│    │  (S3)   │                  │
│  └─────────┘    └─────────┘    └─────────┘                  │
└─────────────────────────────────────────────────────────────┘
      │
      │ (se affected != 'none')
      ▼
┌─────────────────────────────────────────────────────────────┐
│                    deploy.yml (reusable)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  deploy (init → plan → apply → tag)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Workflow

### 1. ci.yml (Entry Point)

- **Trigger**: Push su `master`
- **Ruolo**: Orchestratore principale, chiama gli altri workflow
- Passa `environment: dev` ai workflow chiamati

### 2. build.yml (Reusable Workflow)

| Job | Cosa fa |
|-----|---------|
| **detect** | Usa NX per trovare quali app sono cambiate rispetto all'ultimo deploy (tag `last-deploy-{env}`). Se il tag non esiste, considera tutte le app come affected. |
| **build** | Crea job paralleli (matrix) per ogni app affected. Esegue build, lint, e impacchetta in `.zip`. |
| **upload** | Scarica gli artifact e li carica su S3 al path `{env}/{commit_sha}/{app}.zip` |

### 3. deploy.yml (Reusable Workflow)

Job unico `deploy` con tutto inline:

| Step | Cosa fa |
|------|---------|
| **tofu init** | Clona il repo Terraform esterno, inizializza con backend config per environment |
| **tofu plan** | Esegue `tofu plan` solo sui moduli Lambda delle app affected |
| **tofu apply** | Applica le modifiche infrastrutturali dal piano salvato |
| **tag** | Crea/aggiorna il tag `last-deploy-{env}` per tracciare l'ultimo deploy riuscito |

## Custom Actions

| Action | Scopo |
|--------|-------|
| **setup-environment** | Setup Node.js + npm ci + (opzionale) AWS credentials via OIDC |
| **build-and-package** | Build NX (ncc) + lint + test + crea zip con `run.sh` per Lambda |
| **upload-to-s3** | Scarica artifact e li carica su S3 in parallelo |

## Meccanismo "Affected"

Il sistema è ottimizzato per monorepo NX:

1. All'avvio, cerca il tag `last-deploy-dev`
2. Confronta HEAD con quel tag usando `nx show projects --affected`
3. Builda/deploya solo le app modificate
4. A deploy completato, aggiorna il tag

Questo evita di deployare tutte le app ad ogni push.

## Autenticazione AWS

Usa **OIDC** (OpenID Connect) - niente secret statiche. GitHub assume un ruolo IAM definito nelle variabili dell'environment (`DEV_CI_ROLE`, `DEV_TERRAFORM_ROLE`).
