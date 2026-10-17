# Axion Platform - Production Kubernetes Architecture & Deployment Guide

This directory contains production-grade Kubernetes manifests for deploying the entire Axion industrial IoT condition-monitoring platform to Azure Kubernetes Service (AKS) or any standard Kubernetes cluster.

---

## 1. Production Architecture Overview

The platform is organized into the isolated `axion` namespace with strict separation of concerns, 12-factor application configuration, immutable image tagging, decoupled runtime configurations via `ConfigMap`, and credential segregation via `Secret`.

```text
                                        +--------------------------------------------+
                                        |                Kubernetes                  |
                                        |             Namespace: axion               |
                                        +--------------------------------------------+
                                                               |
  [ Browser Client ]                                           |
          |                                                    |
          +---> [ LoadBalancer :80 ] ------------------------> | ---> [ axion-ui Pods (2 replicas) ]
          |                                                    |        (Nginx SPA + mounted config.js)
          |                                                    |
          +---> [ LoadBalancer :8000 ] ----------------------> | ---> [ telemetry-query-service (2 replicas) ]
                                                               |        (FastAPI dashboard API)
                                                               |               |
  [ simulator-service Pod (1 replica) ]                        |               |
     (Generates simulated IoT readings)                        |               |
          |                                                    |               |
          +---> [ ingestion-service:80 ]                      |               |
                    (FastAPI ingestion API)                     |               |
                          |                                    |               |
                          v                                    v               v
                +----------------------------------------------------------------+
                |                PostgreSQL Database (ClusterIP: 5432)            |
                |               Persistent Volume Claim (10Gi Azure Disk)         |
                |               Initialized via axion-db-schema-init Job         |
                +----------------------------------------------------------------+
```

---

## 2. Production Improvements Implemented

1. **Environment-Agnostic Container Images**:
   - The UI bundle is no longer compiled with hardcoded backend IPs.
   - Dynamic runtime configuration via `public/config.js` and `window.__ENV__`, mounted directly from Kubernetes `ConfigMap` (`axion-ui-config`). The exact same Docker image can be deployed to Dev, Staging, QA, or Production without rebuilding.
   - Nginx is configured with strict `no-store, no-cache, must-revalidate` cache-control headers for `config.js` to ensure immediate propagation on environment updates.
   - FastAPIs read `DATABASE_URL` and `ALLOWED_ORIGINS` from Kubernetes Secrets and ConfigMaps.
   - Telemetry Query Service has a dedicated `/health` endpoint for Kubernetes probes.

2. **Security & Secrets Management**:
   - Production credentials (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`) stored in `axion-db-secret`.
   - Manifests in version control contain no hardcoded development passwords.
   - Principle of least exposure: PostgreSQL and Ingestion services are strictly internal `ClusterIP`.

3. **Storage & Data Durability**:
   - `PersistentVolumeClaim` with `ReadWriteOnce` access mode on Azure Disk CSI (`default` storage class).
   - Deployment strategy set to `Recreate` for database workloads to avoid multi-attach lock conflicts.

4. **Automated, Idempotent Schema Migrations**:
   - Schema init script (`01-extensions.sql`, `02-telemetry.sql`) stored in ConfigMap `axion-schema-config`.
   - Migration Job `axion-db-schema-init` with an `initContainer` verifying `pg_isready` before applying idempotent schema definitions (`CREATE EXTENSION IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

5. **High Availability & Zero-Downtime Rollouts**:
   - Multi-replica stateless services (`ingestion-service`: 2 replicas, `telemetry-query-service`: 2 replicas, `axion-ui`: 2 replicas).
   - Rolling update strategy with `maxSurge: 1` and `maxUnavailable: 0`.
   - Accurate `livenessProbe` and `readinessProbe` configurations across all workloads.
   - Dedicated CPU/Memory resource requests and limits to guarantee QoS and prevent cluster resource starvation.

---

## 3. Manifest File Manifest

| File | Resource | Description |
|---|---|---|
| `00-namespace.yaml` | `Namespace` | Creates isolated `axion` namespace |
| `01-secrets.yaml` | `Secret` | Database credentials and connection URL |
| `02-configmaps.yaml` | `ConfigMap` | SQL schema scripts, simulator settings, CORS settings, UI config.js |
| `03-postgres.yaml` | `PVC`, `Deployment`, `Service` | PostgreSQL stateful instance with 10Gi storage and probes |
| `04-db-migration-job.yaml` | `Job` | Pre-flight migration job with database readiness check |
| `05-ingestion-service.yaml` | `Deployment`, `Service` | Telemetry ingestion API (2 replicas, internal ClusterIP) |
| `06-telemetry-query-service.yaml` | `Deployment`, `Service` | Query API for dashboard (2 replicas, LoadBalancer) |
| `07-simulator.yaml` | `Deployment` | IoT condition monitoring simulator |
| `08-ui.yaml` | `Deployment`, `Service` | React/Nginx dashboard UI (2 replicas, LoadBalancer, mounted config) |
| `09-ingress.yaml` | `Ingress` | Optional unified ingress for TLS/hostname routing |

---

## 4. Deployment Instructions

### Step 1: Push Images to ACR
```bash
docker push acrudayaksdemo.azurecr.io/axion-ingestion:1.0.0
docker push acrudayaksdemo.azurecr.io/axion-telemetry-query:1.0.0
docker push acrudayaksdemo.azurecr.io/axion-simulator:1.0.0
docker push acrudayaksdemo.azurecr.io/axion-ui:1.0.0
```

### Step 2: Apply Base Resources
```bash
kubectl apply -f k8s-production/00-namespace.yaml
kubectl apply -f k8s-production/01-secrets.yaml
kubectl apply -f k8s-production/02-configmaps.yaml
```

### Step 3: Deploy PostgreSQL & Run Migration
```bash
kubectl apply -f k8s-production/03-postgres.yaml
kubectl rollout status deployment/postgres -n axion
kubectl apply -f k8s-production/04-db-migration-job.yaml
kubectl wait --for=condition=complete job/axion-db-schema-init -n axion --timeout=60s
```

### Step 4: Deploy Core Services
```bash
kubectl apply -f k8s-production/05-ingestion-service.yaml
kubectl apply -f k8s-production/06-telemetry-query-service.yaml
kubectl apply -f k8s-production/07-simulator.yaml
kubectl rollout status deployment/ingestion-service -n axion
kubectl rollout status deployment/telemetry-query-service -n axion
```

### Step 5: Configure UI API Endpoint & Deploy UI
Once `telemetry-service` obtains an external IP:
```bash
$API_IP = (kubectl get svc telemetry-service -n axion -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
# Update axion-ui-config ConfigMap with $API_IP:8000
kubectl apply -f k8s-production/08-ui.yaml
kubectl rollout status deployment/axion-ui -n axion
```
