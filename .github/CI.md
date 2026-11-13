# CI/CD Pipeline

## Flow

```
Push to main
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                     ci.yml (orchestrator)                    │
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
      │ (if affected != 'none')
      ▼
┌─────────────────────────────────────────────────────────────┐
│                    deploy.yml (reusable)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  deploy (init → plan → apply → tag)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Workflows

### 1. ci.yml (entry point)

- **Trigger**: push to `main`
- **Role**: calls `build.yml` and then `deploy.yml`, passing `environment: dev` to both

`ralph.yml` calls the same two workflows with `environment: prod`. It has no trigger of its own and is started by hand from the Actions tab.

### 2. build.yml (reusable workflow)

| Job | What it does |
|-----|--------------|
| **detect** | Uses Nx to find the applications changed since the last deploy, marked by the `last-deploy-{env}` tag. If the tag does not exist yet, it compares against the first commit, so every application counts as changed. |
| **build** | Starts one parallel job per changed application (a matrix). Each job builds and lints its application and packages it as a `.zip`. |
| **upload** | Downloads the packages and uploads them to S3 under `{env}/{commit_sha}/{app}.zip`. |

### 3. deploy.yml (reusable workflow)

A single `deploy` job runs these steps:

| Step | What it does |
|------|--------------|
| **tofu init** | Checks out the infrastructure repository and initialises OpenTofu with the backend configuration of the environment. |
| **tofu plan** | Runs `tofu plan` only on the Lambda modules of the changed applications, pointing each one at the package of the current commit. |
| **tofu apply** | Applies the saved plan. |
| **tag** | Moves the `last-deploy-{env}` tag to the deployed commit, so the next run starts from there. |

## Custom actions

| Action | Purpose |
|--------|---------|
| **setup-environment** | Installs Node.js and the dependencies with `npm ci`, caching `node_modules`. It can also link `libs/common` into `node_modules` and sign in to AWS through OIDC. |
| **build-and-package** | Builds the application with Nx and ncc, lints it and zips it together with the `run.sh` the Lambda starts from. Tests can be turned on with an input, but the pipeline leaves them off. An application with its own `build.sh` (`render`, written in Python) builds its zip with that script instead. |
| **upload-to-s3** | Downloads the packages and uploads them to S3 in parallel. |

## Changed applications

The pipeline builds and deploys only what changed, using Nx's knowledge of the monorepo:

1. at the start, it looks for the `last-deploy-dev` tag;
2. it compares `HEAD` with that tag through `nx show projects --affected`;
3. it builds and deploys only the applications that changed;
4. once the deploy succeeds, it moves the tag.

A push that touches only one application therefore redeploys that application alone.

## AWS authentication

The workflows sign in to AWS through GitHub's OIDC provider, so the repository stores no AWS keys. Each job assumes an IAM role whose ARN is read from the variables of the GitHub environment: `DEV_CI_ROLE` for the upload to S3 and `DEV_TERRAFORM_ROLE` for the deploy.
