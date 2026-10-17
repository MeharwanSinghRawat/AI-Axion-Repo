# Axion Deployment on AKS

This guide explains how to deploy the complete Axion platform to Azure Kubernetes Service (AKS).

## Deployment Architecture

The AKS deployment contains these workloads:

- PostgreSQL: internal database
- Ingestion service: internal FastAPI API that receives telemetry
- Telemetry query service: dashboard API, exposed publicly or through an Ingress
- Data simulator: internal background workload that sends test telemetry
- Axion UI: Nginx-hosted React application, exposed publicly or through an Ingress

Recommended production traffic flow:

```text
Browser -> HTTPS Ingress -> Axion UI service
Browser -> HTTPS Ingress -> Telemetry query service
Simulator -> ingestion-service:80
Ingestion service -> db-service:5432
Telemetry query service -> db-service:5432
```

## Values That Must Change Before Deployment

### 1. Container image names and tags

The current manifests use Docker Hub images such as `udaypsy/axion-ui:v1.1` and `udaypsy/telementry:v1.0`. Replace these with images pushed to your registry, preferably Azure Container Registry (ACR):

```yaml
image: <acr-name>.azurecr.io/axion-ingestion:<git-sha>
image: <acr-name>.azurecr.io/axion-telemetry-query:<git-sha>
image: <acr-name>.azurecr.io/axion-simulator:<git-sha>
image: <acr-name>.azurecr.io/axion-ui:<git-sha>
```

Do not use `latest` for production deployments. Use an immutable version or Git commit tag.

### 2. API URL in the UI

The UI calls the telemetry query API from these files:

- `axion-ui/src/App.tsx`
- `axion-ui/src/components/pages/DashboardView.tsx`
- `axion-ui/src/components/pages/HistoricalTrends.tsx`

Before building the UI image, replace the development API URL:

```text
http://20.119.124.75:8000
```

with the final HTTPS API URL, for example:

```text
https://api.<your-domain>
```

The URL is compiled into the Vite production bundle, so changing it after the Docker image is built will not update the browser application. Rebuild and redeploy the UI after changing it.

For a temporary AKS test, the API URL can be the telemetry query LoadBalancer public IP. HTTPS is preferred for production. An HTTPS UI calling an HTTP API will be blocked by browser mixed-content protection.

### 3. Kubernetes service exposure

`telemetry-service.yml` currently uses `type: LoadBalancer`, which is suitable for a temporary test. For production, expose the UI and query API through an HTTPS Ingress with hostnames such as:

```text
app.<your-domain> -> axion-ui-service:80
api.<your-domain> -> telemetry-service:8000
```

If using a temporary LoadBalancer instead of Ingress, add this to `axion-ui/axionui-service.yml`:

```yaml
type: LoadBalancer
```

This creates a separate public IP for the UI. Restrict the query API and use HTTPS before production use.

### 4. Database credentials

The current Python defaults and PostgreSQL manifest contain development credentials. Do not use them in production. Create a Kubernetes Secret and configure both FastAPI deployments with `DATABASE_URL` from that Secret.

The Kubernetes service hostname remains:

```text
db-service:5432
```

The production connection string should use URL-encoded special characters, for example:

```text
postgresql://<user>:<url-encoded-password>@db-service:5432/axiondb
```

### 5. PostgreSQL persistence

The current PostgreSQL deployment has no `PersistentVolumeClaim`. Any pod rescheduling can lose database data. Add a PVC and mount it at `/var/lib/postgresql/data` before production deployment. Also configure backups and a restore procedure.

### 6. CORS and authentication

Both FastAPI services currently allow all origins. Change `allow_origins=["*"]` to the exact UI origin, such as:

```python
allow_origins=["https://app.<your-domain>"]
```

Add authentication and authorization at the API or Ingress boundary before exposing the API publicly.

## Step 1: Create or Select AKS

```powershell
az login
az account set --subscription "<subscription-id>"

az group create --name axion-rg --location <azure-region>

az aks create `
  --resource-group axion-rg `
  --name axion-aks `
  --node-count 2 `
  --node-vm-size Standard_B2s `
  --enable-managed-identity `
  --attach-acr <acr-name>

az aks get-credentials --resource-group axion-rg --name axion-aks
kubectl get nodes
```

If the AKS cluster already exists, only run `az aks get-credentials` and verify the nodes.

## Step 2: Create an Azure Container Registry

```powershell
az acr create `
  --resource-group axion-rg `
  --name <acr-name> `
  --sku Basic

az aks update `
  --resource-group axion-rg `
  --name axion-aks `
  --attach-acr <acr-name>
```

Build and push each image from the project root:

```powershell
$TAG = "v1.0.0"
$REGISTRY = "<acr-name>.azurecr.io"

docker build -t "$REGISTRY/axion-ingestion:$TAG" ./axion-ingestion-service
docker build -t "$REGISTRY/axion-telemetry-query:$TAG" ./axion-telemetry-query-service
docker build -t "$REGISTRY/axion-simulator:$TAG" ./axion-data-simulator
docker build -t "$REGISTRY/axion-ui:$TAG" ./axion-ui

az acr login --name <acr-name>
docker push "$REGISTRY/axion-ingestion:$TAG"
docker push "$REGISTRY/axion-telemetry-query:$TAG"
docker push "$REGISTRY/axion-simulator:$TAG"
docker push "$REGISTRY/axion-ui:$TAG"
```

Update all deployment manifests with these image names before applying them.

## Step 3: Create Namespace and Secrets

Use a namespace to keep Axion resources isolated:

```powershell
kubectl create namespace axion
```

Create the database Secret. Use a strong password and do not commit the command or Secret YAML to source control:

```powershell
kubectl -n axion create secret generic axion-db-secret `
  --from-literal=POSTGRES_USER=<database-user> `
  --from-literal=POSTGRES_PASSWORD=<database-password> `
  --from-literal=POSTGRES_DB=axiondb `
  --from-literal=DATABASE_URL='postgresql://<user>:<url-encoded-password>@db-service:5432/axiondb'
```

Update the PostgreSQL deployment to read `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from the Secret. Update the ingestion and query deployments to read `DATABASE_URL` from the same Secret.

## Step 4: Deploy PostgreSQL and Schema

Apply the database workload in the Axion namespace:

```powershell
kubectl -n axion apply -f menifests/db-deployement.yml
kubectl -n axion apply -f menifests/db-service.yml
kubectl -n axion get pods -l app=postgres
kubectl -n axion rollout status deployment/postgres
```

The SQL files are not automatically applied by the current PostgreSQL deployment. Apply them using a temporary PostgreSQL client pod, pgAdmin, or a migration Job after the database is ready:

```powershell
kubectl -n axion run psql-client --rm -it `
  --image=postgres:17 `
  --restart=Never `
  --env="PGPASSWORD=<database-password>" `
  -- psql -h db-service -U <database-user> -d axiondb
```

Run these files in order:

```text
axion-database-schema/01-extensions.sql
axion-database-schema/02-telemetry.sql
```

For repeatable deployments, convert these commands into a Kubernetes migration Job or use a migration tool.

## Step 5: Deploy the Backend Services

Update the deployment manifests with the ACR image names and Secret-based environment variables, then apply them:

```powershell
kubectl -n axion apply -f axion-ingestion-service/ingestion-service-deployment.yml
kubectl -n axion apply -f axion-ingestion-service/ingestion-service.yml
kubectl -n axion apply -f axion-telemetry-query-service/telemetry-deployment.yml
kubectl -n axion apply -f axion-telemetry-query-service/telemetry-service.yml

kubectl -n axion rollout status deployment/ingestion-service-deployment
kubectl -n axion rollout status deployment/telemetry-query-service-deployment
kubectl -n axion get svc
```

Test the query API using its external IP:

```powershell
kubectl -n axion get svc telemetry-service
Invoke-WebRequest "http://<external-ip>:8000/dashboard/summary"
Invoke-WebRequest "http://<external-ip>:8000/devices"
```

A successful response should be HTTP 200 with JSON data. If the API returns a database error, inspect the query-service logs:

```powershell
kubectl -n axion logs deployment/telemetry-query-service-deployment
```

## Step 6: Deploy the Simulator

The simulator must use the internal Kubernetes DNS name, not a public IP:

```text
http://ingestion-service.axion.svc.cluster.local:80/api/v1/telemetry/ingest
```

Set this value in the simulator Deployment as the `API_URL` environment variable, then apply it:

```powershell
kubectl -n axion apply -f axion-data-simulator/simulator-deployment.yml
kubectl -n axion rollout status deployment/simlulator-service-deployment
kubectl -n axion logs deployment/simlulator-service-deployment --tail=100
```

The deployment name is currently misspelled as `simlulator-service-deployment`. You may keep it for compatibility or rename it consistently to `simulator-service-deployment` in the manifest and commands.

After the simulator runs for a short time, verify that `/devices` returns devices and recent timestamps.

## Step 7: Deploy the UI

Before building the UI image, set the API URL in all three UI files to the final API hostname. Then rebuild and push the UI image. Apply the UI deployment and service:

```powershell
kubectl -n axion apply -f axion-ui/axionui-deployment.yml
kubectl -n axion apply -f axion-ui/axionui-service.yml
kubectl -n axion rollout status deployment/axion-ui-deployment
kubectl -n axion get svc axion-ui-service
```

For a temporary test, set `type: LoadBalancer` in `axionui-service.yml` and open the assigned external IP in a browser. For production, use the Ingress option below and set the UI API URL to `https://api.<your-domain>` before building.

## Step 8: Configure HTTPS Ingress

Install an NGINX Ingress Controller or use the Azure Application Gateway Ingress Controller. Then create an Ingress that routes:

```text
app.<your-domain> -> axion-ui-service:80
api.<your-domain> -> telemetry-service:8000
```

Configure DNS A records for both hostnames to the Ingress public IP. Issue TLS certificates using cert-manager or Azure-managed certificates. After HTTPS is active, rebuild the UI with:

```text
https://api.<your-domain>
```

Do not expose PostgreSQL or the ingestion service publicly.

## Step 9: Verify the Full Pipeline

```powershell
kubectl -n axion get pods
kubectl -n axion get svc
kubectl -n axion describe pod -l app=simulator-service-pod
kubectl -n axion logs deployment/simlulator-service-deployment --tail=50
```

Verify these checks in order:

1. PostgreSQL pod is `Running` and ready.
2. Database schema exists.
3. Ingestion service is ready and can connect to `db-service`.
4. Query service returns HTTP 200 for `/dashboard/summary` and `/devices`.
5. Simulator logs show successful ingestion requests.
6. UI opens without browser console CORS or mixed-content errors.
7. A device detail page loads latest and trend telemetry.

## Current Project Items to Fix

Before a production AKS rollout, address these repository items:

- Replace hardcoded UI API URLs with a build-time environment variable such as `VITE_API_BASE`.
- Replace development database credentials with Kubernetes Secrets.
- Add PostgreSQL persistent storage and backups.
- Add readiness and liveness probes to all deployments.
- Add resource requests and limits.
- Restrict CORS from `*` to the UI origin.
- Add HTTPS Ingress and authentication.
- Use immutable image tags.
- Apply database migrations through a Job or migration tool.
- Correct the `simlulator` deployment spelling when making a breaking manifest change.
- Consider renaming the `menifests` directory to `manifests` in a separate cleanup change.

## Useful Commands

```powershell
kubectl -n axion get all
kubectl -n axion describe service telemetry-service
kubectl -n axion logs deployment/ingestion-service-deployment
kubectl -n axion logs deployment/telemetry-query-service-deployment
kubectl -n axion rollout restart deployment/axion-ui-deployment
kubectl -n axion rollout history deployment/axion-ui-deployment
```
