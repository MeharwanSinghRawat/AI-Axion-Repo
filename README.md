# Axion Industrial IoT Condition-Monitoring Platform
## Production Kubernetes (AKS) Deployment & Architecture Guide

Axion is an enterprise-grade industrial IoT condition-monitoring platform designed for refinery equipment (pumps, motors, and compressors). It ingests high-frequency sensor readings, stores them in PostgreSQL with time-series indexing, exposes telemetry query APIs via FastAPI, and visualizes asset health through an interactive React dashboard.

This repository has been configured and deployed to **Azure Kubernetes Service (AKS)** using production-grade best practices, completely environment-agnostic container images, and Kubernetes native `ConfigMap` and `Secret` configurations.

---

## 1. Live Deployment Endpoints & Credentials

| Service | Public Endpoint | Port | Type | Status |
|---|---|---|---|---|
| **Axion Dashboard UI** | [http://134.33.237.7](http://134.33.237.7) | `80` | Azure LoadBalancer | **Active & Live** |
| **Telemetry Query API** | [http://20.246.189.227:8000](http://20.246.189.227:8000) | `8000` | Azure LoadBalancer | **Active & Live** |
| **API Health Check** | [http://20.246.189.227:8000/health](http://20.246.189.227:8000/health) | `8000` | REST API | **`{"status":"UP"}`** |
| **Dashboard Summary** | [http://20.246.189.227:8000/dashboard/summary](http://20.246.189.227:8000/dashboard/summary) | `8000` | REST API | **27 Devices Streaming** |

### 🔐 UI Login Credentials
* **Login URL:** [http://134.33.237.7](http://134.33.237.7)
* **Enterprise Email:** `info@devopsinsiders.com`
* **Password:** `P@ssw01rd@123`

---

## 2. Production Architecture & Traffic Flow

```text
                                        +-------------------------------------------------------+
                                        |                   Kubernetes Cluster                  |
                                        |                    Namespace: axion                   |
                                        +-------------------------------------------------------+
                                                                    |
  [ Browser Client ]                                                |
          |                                                         |
          +---> [ LoadBalancer :80 ] -----------------------------> | ---> [ axion-ui Pods (2 replicas) ]
          |     (External IP: 134.33.237.7)                         |        (Nginx SPA + mounted config.js)
          |                                                         |
          +---> [ LoadBalancer :8000 ] ---------------------------> | ---> [ telemetry-query-service (2 replicas) ]
                (External IP: 20.246.189.227)                       |        (FastAPI query engine)
                                                                    |               |
  [ simulator-service Pod (1 replica) ]                             |               |
     (Generates simulated IoT sensor telemetry)                     |               |
          |                                                         |               |
          +---> [ ingestion-service:80 ] -------------------------> |               |
                    (Internal ClusterIP: FastAPI ingestion engine)   |               |
                          |                                         |               |
                          v                                         v               v
                +-------------------------------------------------------------------------------+
                |                      PostgreSQL Database (postgres-service:5432)              |
                |                     Persistent Volume Claim (10Gi Azure Disk CSI)             |
                |                     Schema Initialized via axion-db-schema-init Job           |
                +-------------------------------------------------------------------------------+
```

---

## 3. Why We Deployed It This Way (Production Design Decisions)

### A. Environment-Agnostic Container Images ("Build Once, Deploy Anywhere")
* **The Problem:** The initial UI code hardcoded a development IP (`http://20.81.28.112:8000`) into `App.tsx`, `DashboardView.tsx`, and `HistoricalTrends.tsx`. Because Vite compiles TypeScript into static JavaScript at build time, any IP change required rebuilding the entire container image.
* **Our Solution:** Created a dynamic runtime configuration pattern using `public/config.js` and `src/config.ts`. In Kubernetes, the [`axion-ui-config`](file:///d:/axion-project/k8s-production/02-configmaps.yaml) ConfigMap mounts `config.js` containing `window.__ENV__.API_BASE` directly into the container. The Docker image itself has zero hardcoded IPs and can be promoted from Dev to Staging to Production without rebuilding.

### B. Security & Least Privilege
* **No Plaintext Passwords in Git:** Credentials (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`) are isolated in a Kubernetes Secret ([`01-secrets.yaml`](file:///d:/axion-project/k8s-production/01-secrets.yaml)).
* **Protected Internal Workloads:** PostgreSQL and Ingestion services are exposed purely via internal `ClusterIP` (`postgres-service:5432` and `ingestion-service:80`). Only public-facing components (`axion-ui` and `telemetry-service`) are exposed via LoadBalancer.

### C. Persistent Storage & High Availability
* **Persistent Storage:** Attached an Azure Disk CSI PersistentVolumeClaim (`postgres-pvc`, 10Gi) using `Recreate` deployment strategy to eliminate data loss across pod restarts.
* **Stateless High Availability:** Deployed 2 replicas each for `axion-ui`, `ingestion-service`, and `telemetry-query-service` with rolling update zero-downtime deployments (`maxSurge: 1`, `maxUnavailable: 0`).
* **Health Probes:** Configured `livenessProbe` and `readinessProbe` across all microservices.

### D. Automated & Idempotent Schema Migrations
* Rather than requiring manual `psql` interactive execution, an automated Kubernetes Job ([`04-db-migration-job.yaml`](file:///d:/axion-project/k8s-production/04-db-migration-job.yaml)) runs with an `initContainer` verifying `pg_isready` before applying idempotent DDL statements (`CREATE EXTENSION IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

---

## 4. Step-by-Step Deployment Procedure

### Step 1: Code Modifications for Portability
1. **Axion UI**:
   - Created [`axion-ui/public/config.js`](file:///d:/axion-project/axion-ui/public/config.js) and [`axion-ui/src/config.ts`](file:///d:/axion-project/axion-ui/src/config.ts).
   - Injected `<script src="/config.js"></script>` into [`axion-ui/index.html`](file:///d:/axion-project/axion-ui/index.html).
   - Configured cache-control headers (`no-store, no-cache`) in [`axion-ui/nginx.conf`](file:///d:/axion-project/axion-ui/nginx.conf).
   - Replaced static constants with `import { API_BASE } from './config'` in `App.tsx`, `DashboardView.tsx`, and `HistoricalTrends.tsx`.
2. **Backend Services**:
   - Added `/health` probe endpoint and dynamic `ALLOWED_ORIGINS` CORS to [`axion-telemetry-query-service/main.py`](file:///d:/axion-project/axion-telemetry-query-service/main.py).
   - Added `import os` and dynamic CORS to [`axion-ingestion-service/main.py`](file:///d:/axion-project/axion-ingestion-service/main.py).
   - Added batch logging and graceful network error handling to [`axion-data-simulator/simulator.py`](file:///d:/axion-project/axion-data-simulator/simulator.py).

*(Full line-by-line diffs are documented in [`change.md`](file:///d:/axion-project/change.md)).*

---

### Step 2: Build and Push Docker Images to ACR
All four container images were built and pushed to the Azure Container Registry `acrudayaksdemo.azurecr.io` with immutable version tags:

```bash
az acr login --name acrudayaksdemo

# Ingestion Service
docker build -t acrudayaksdemo.azurecr.io/axion-ingestion:1.0.0 ./axion-ingestion-service
docker push acrudayaksdemo.azurecr.io/axion-ingestion:1.0.0

# Telemetry Query Service
docker build -t acrudayaksdemo.azurecr.io/axion-telemetry-query:1.0.0 ./axion-telemetry-query-service
docker push acrudayaksdemo.azurecr.io/axion-telemetry-query:1.0.0

# IoT Data Simulator
docker build -t acrudayaksdemo.azurecr.io/axion-simulator:1.0.0 ./axion-data-simulator
docker push acrudayaksdemo.azurecr.io/axion-simulator:1.0.0

# React Web UI
docker build -t acrudayaksdemo.azurecr.io/axion-ui:1.0.0 ./axion-ui
docker push acrudayaksdemo.azurecr.io/axion-ui:1.0.0
```

---

### Step 3: Apply Namespace, Secrets & ConfigMaps
Created the isolated `axion` namespace and provisioned database credentials and configuration templates:

```bash
kubectl apply -f k8s-production/00-namespace.yaml
kubectl apply -f k8s-production/01-secrets.yaml
kubectl apply -f k8s-production/02-configmaps.yaml
```

---

### Step 4: Deploy PostgreSQL & Run Migration Job
Deployed the PostgreSQL database with Azure Disk persistence, then ran the idempotent schema migration Job:

```bash
# Deploy PostgreSQL
kubectl apply -f k8s-production/03-postgres.yaml
kubectl rollout status deployment/postgres -n axion --timeout=120s

# Run Schema Migration
kubectl apply -f k8s-production/04-db-migration-job.yaml
kubectl wait --for=condition=complete job/axion-db-schema-init -n axion --timeout=60s
```

---

### Step 5: Deploy Backend Services & Simulator
Deployed the 2-replica ingestion API, the 2-replica telemetry query API, and the IoT simulator:

```bash
kubectl apply -f k8s-production/05-ingestion-service.yaml
kubectl apply -f k8s-production/06-telemetry-query-service.yaml
kubectl apply -f k8s-production/07-simulator.yaml

kubectl rollout status deployment/ingestion-service -n axion
kubectl rollout status deployment/telemetry-query-service -n axion
kubectl rollout status deployment/simulator-service -n axion
```

---

### Step 6: Bind UI ConfigMap & Deploy UI
Once `telemetry-service` acquired its Azure LoadBalancer public IP (`20.246.189.227`), updated `axion-ui-config` in `02-configmaps.yaml` and deployed the UI:

```bash
# Update ConfigMap with live API endpoint
kubectl apply -f k8s-production/02-configmaps.yaml

# Deploy React Web UI
kubectl apply -f k8s-production/08-ui.yaml
kubectl rollout status deployment/axion-ui -n axion
```

---

## 5. Directory Structure of Manifests ([`k8s-production`](file:///d:/axion-project/k8s-production))

```text
k8s-production/
├── 00-namespace.yaml             # Creates 'axion' namespace with environment labels
├── 01-secrets.yaml               # POSTGRES_USER, POSTGRES_PASSWORD, and DATABASE_URL
├── 02-configmaps.yaml            # Schema DDL, simulator settings, CORS, and UI config.js
├── 03-postgres.yaml              # PVC (10Gi Azure Disk), Deployment (Recreate), ClusterIP
├── 04-db-migration-job.yaml      # Pre-flight migration Job with pg_isready initContainer
├── 05-ingestion-service.yaml     # 2-replica Ingestion deployment & ClusterIP service
├── 06-telemetry-query-service.yaml# 2-replica Telemetry query deployment & LoadBalancer
├── 07-simulator.yaml             # IoT sensor data generator deployment
├── 08-ui.yaml                    # 2-replica Nginx UI deployment & LoadBalancer
├── 09-ingress.yaml               # Optional Ingress controller manifest for TLS/domain routing
└── README.md                     # Manifests-specific documentation
```

---

## 6. Verification and Status Check

Run the following commands to inspect the cluster health:

```bash
# Check all resources in the axion namespace
kubectl get all -n axion

# Verify pods are healthy (2/2 for stateless, 1/1 for stateful)
kubectl get pods -n axion

# Check public LoadBalancer IP allocations
kubectl get svc -n axion

# Check live simulator ingestion logs
kubectl logs deployment/simulator-service -n axion --tail=20

# Query API health directly
curl http://20.246.189.227:8000/health
curl http://20.246.189.227:8000/dashboard/summary
```
