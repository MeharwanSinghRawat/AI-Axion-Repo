# Axion Platform - Production CI/CD Pipeline Architecture

This directory contains the production-grade Azure DevOps CI/CD pipeline and modular YAML templates for the Axion IoT platform.

---

## 1. Key Pipeline Principles Implemented

1. **Native Azure DevOps Tasks (Zero Raw Scripts)**:
   - Uses `Docker@2` for building, tagging, and pushing container images.
   - Uses `KubernetesManifest@1` for deploying manifests and performing dynamic image tag substitution.
   - Uses `Kubernetes@1` for verifying rollout status with automated quality gates.
   - Uses `PublishTestResults@2` to publish vulnerability results directly into the Azure DevOps **Tests** dashboard tab.
   - Uses `PublishPipelineArtifact@1` to archive audit reports.

2. **Template-Driven Architecture (DRY - Don't Repeat Yourself)**:
   - Instead of writing build, scan, and push logic 4 times for each microservice, a single reusable template [`build-and-scan-image.yml`](file:///d:/axion-project/pipelines/templates/build-and-scan-image.yml) handles all services with parameterized inputs.
   - Workload rollouts are abstracted into [`deploy-workload.yml`](file:///d:/axion-project/pipelines/templates/deploy-workload.yml).
   - Manifest audits are abstracted into [`scan-manifests.yml`](file:///d:/axion-project/pipelines/templates/scan-manifests.yml).

3. **Enterprise Security Scanning Suite Integrated**:
   - **Aqua Security Trivy (Free & Open Source)**:
     - Scans Kubernetes manifests for security misconfigurations (root containers, missing limits, privilege escalation).
     - Scans built Docker images for CVEs and vulnerabilities before push.
     - Automatically exports JUnit XML reports to the Azure DevOps **Tests** tab.
   - **Palo Alto Prisma Cloud (Twistcli)**:
     - Pre-configured enterprise hook (`enablePrismaScan: true/false`).
   - **Synopsys Black Duck**:
     - Pre-configured Software Composition Analysis (SCA) dependency scanner hook (`enableBlackDuckScan: true/false`).

4. **Multi-Stage Deployment Gates**:
   - **Stage 1 (IaC Audit)**: Validates Kubernetes manifests.
   - **Stage 2 (CI & Security)**: Parallel builds and scans of all 4 microservices.
   - **Stage 3 (CD - Database Gate)**: Provisions storage, database, and runs the schema migration Job.
   - **Stage 4 (CD - Workloads)**: Deploys ingestion, telemetry query, simulator, and UI services with image substitution and automated rollout validation.

---

## 2. Directory Structure

```text
pipelines/
├── azure-pipelines.yml              # Main multi-stage pipeline definition
├── README.md                        # Pipeline setup and configuration guide
└── templates/
    ├── build-and-scan-image.yml     # Reusable template: Docker build, Trivy scan, ACR push
    ├── deploy-workload.yml          # Reusable template: KubernetesManifest@1 deploy & rollout check
    └── scan-manifests.yml           # Reusable template: Aqua Trivy IaC manifest security scan
```

---

## 3. Azure DevOps Prerequisites & Setup

To run this pipeline in Azure DevOps:

### 1. Service Connection Setup (Only ONE Required!)
Go to **Project Settings** -> **Service connections**:
* **`aks-connection`** (Type: *Azure Resource Manager* / `azurerm`):
  * Scope Level: *Subscription* or *Resource group* (`rg-aks-Uday`)
  * Service Connection Name: `aks-connection`
  * **Note**: This single ARM service connection handles **both** ACR authentication (via `az acr login`) and AKS deployments (via `KubernetesManifest@1`), so no separate Docker Registry connection is needed!

### 2. Create Environment
Go to **Pipelines** -> **Environments**:
* Create an environment named **`production`**.
* (Optional) Configure approval gates or manual validation if you want human approvals between database migration and workload deployment.

### 3. Create the Pipeline
* Go to **Pipelines** -> **New pipeline** -> **Azure Repos Git** (`axion-project`).
* Select **Existing Azure Pipelines YAML file**.
* Path: `/azure-pipelines.yml`.
* Run the pipeline!
