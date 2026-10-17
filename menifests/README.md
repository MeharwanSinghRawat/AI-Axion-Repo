# Axion

Axion is an industrial IoT condition-monitoring platform for refinery equipment. It continuously generates telemetry for pumps, motors, and compressors, stores the readings in PostgreSQL, exposes dashboard-oriented APIs, and presents the data through a React dashboard.

## Architecture

```text
+-------------------+       POST telemetry       +-----------------------+
| Data Simulator    | -------------------------> | Ingestion Service     |
| Python            |                            | FastAPI               |
+-------------------+                            +-----------+-----------+
                                                            |
                                                            | asyncpg
                                                            v
                                                  +-----------------------+
                                                  | PostgreSQL            |
                                                  | axiondb               |
                                                  +-----------+-----------+
                                                            ^
                                                            | SQL queries
                                                  +---------+-------------+
                                                  | Telemetry Query       |
                                                  | Service (FastAPI)     |
                                                  +---------+-------------+
                                                            ^
                                                            | REST
                                                  +---------+-------------+
                                                  | Axion UI              |
                                                  | React + TypeScript    |
                                                  +-----------------------+
```

## Repository Structure

| Directory | Purpose | Main technology |
|---|---|---|
| `axion-data-simulator` | Generates realistic telemetry and sends it to the ingestion API | Python |
| `axion-database-schema` | PostgreSQL extensions and telemetry table definitions | SQL |
| `axion-ingestion-service` | Validates and stores telemetry; also exposes raw telemetry queries | FastAPI, asyncpg |
| `axion-telemetry-query-service` | Provides dashboard summary, device, trend, throughput, and region APIs | FastAPI, asyncpg |
| `axion-ui` | Web dashboard for fleet and device monitoring | React, TypeScript, Vite |
| `menifests` | Kubernetes deployments and services for PostgreSQL and the platform workloads | Kubernetes YAML |

## Data Flow

1. The simulator creates readings for refinery devices every five seconds by default.
2. The simulator sends batches to `POST /api/v1/telemetry/ingest` on the ingestion service.
3. The ingestion service validates each payload and writes it to the `telemetry` table.
4. The telemetry query service reads the latest and historical values from PostgreSQL.
5. The UI calls the query service and renders fleet, device, trend, throughput, topology, and alarm views.

## Prerequisites

For local development:

- Python 3.12 or newer
- Node.js 20 or newer
- PostgreSQL 13 or newer
- Docker, optional
- Kubernetes and `kubectl`, optional

## Database Setup

Create the database and run the schema scripts in order:

```bash
createdb axiondb
psql -h localhost -U admin -d axiondb -f axion-database-schema/01-extensions.sql
psql -h localhost -U admin -d axiondb -f axion-database-schema/02-telemetry.sql
```

The current schema creates the `telemetry` table and indexes for device and timestamp queries. The database connection string format is:

```text
postgresql://<user>:<password>@<host>:<port>/<database>
```

## Run Locally

Start PostgreSQL first, then run the services in separate terminals.

### Ingestion Service

```powershell
cd axion-ingestion-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DATABASE_URL = "postgresql://admin:P%40ssw0rd123@localhost:5432/axiondb"
uvicorn main:app --reload --port 8000
```

The ingestion API is available at `http://localhost:8000`. OpenAPI documentation is at `http://localhost:8000/docs`.

### Telemetry Query Service

Run it on a different local port when the ingestion service is already using port 8000:

```powershell
cd axion-telemetry-query-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DATABASE_URL = "postgresql://admin:P%40ssw0rd123@localhost:5432/axiondb"
$env:PORT = "8001"
uvicorn main:app --reload --port 8001
```

The dashboard API is then available at `http://localhost:8001`.

### Data Simulator

Point the simulator at the local ingestion service:

```powershell
cd axion-data-simulator
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:API_URL = "http://localhost:8000/api/v1/telemetry/ingest"
$env:INTERVAL_SECONDS = "5"
python simulator.py
```

### Web UI

The UI currently has its query-service endpoint configured in the source. For local use, update the `API_BASE` constants in `axion-ui/src/App.tsx`, `axion-ui/src/components/pages/DashboardView.tsx`, and `axion-ui/src/components/pages/HistoricalTrends.tsx` to the local query-service URL, such as `http://localhost:8001`.

```powershell
cd axion-ui
npm install
npm run dev
```

Build and lint the UI with:

```powershell
npm run build
npm run lint
```

## API Reference

### Ingestion Service

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/api/v1/telemetry?deviceId=<id>&limit=100` | Read recent raw telemetry |
| `POST` | `/api/v1/telemetry/ingest` | Store a telemetry reading |

Example ingestion payload:

```json
{
  "deviceId": "AX-PMP-N01-A4F9",
  "deviceType": "PUMP",
  "refineryRegion": "NORTH_PLANT",
  "timestamp": "2026-08-25T12:00:00Z",
  "metrics": {
    "temperature": 72.5,
    "vibration": 3.1,
    "current": 14.2
  }
}
```

### Telemetry Query Service

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dashboard/summary` | Online asset count and latest update |
| `GET` | `/devices` | Latest reading for every device |
| `GET` | `/devices/{device_id}/latest` | Latest reading for one device |
| `GET` | `/devices/{device_id}/trends?hours=1` | Historical device trend data |
| `GET` | `/devices/top-anomalous` | Devices with the highest anomaly levels |
| `GET` | `/dashboard/throughput` | Throughput data for the dashboard |
| `GET` | `/dashboard/regions` | Region-level device and alert summary |

## Docker

Each service has its own Dockerfile. Build images from the corresponding directory:

```powershell
docker build -t axion-ingestion-service ./axion-ingestion-service
docker build -t axion-telemetry-query-service ./axion-telemetry-query-service
docker build -t axion-data-simulator ./axion-data-simulator
docker build -t axion-ui ./axion-ui
```

The UI image serves the Vite production build through Nginx on port 80. The Python services listen on port 8000 inside their containers.

## Kubernetes Deployment

The manifests are split across the service directories and `menifests`:

```powershell
kubectl apply -f menifests/db-deployement.yml
kubectl apply -f menifests/db-service.yml
kubectl apply -f axion-ingestion-service/ingestion-service-deployment.yml
kubectl apply -f axion-ingestion-service/ingestion-service.yml
kubectl apply -f axion-telemetry-query-service/telemetry-deployment.yml
kubectl apply -f axion-telemetry-query-service/telemetry-service.yml
kubectl apply -f axion-data-simulator/simulator-deployment.yml
kubectl apply -f axion-ui/axionui-deployment.yml
kubectl apply -f axion-ui/axionui-service.yml
```

Check workload and service status:

```powershell
kubectl get pods
kubectl get svc
kubectl logs deployment/telemetry-query-service-deployment
```

The telemetry query service is configured as a `LoadBalancer` on port `8000`. The ingestion service is an internal `ClusterIP` on port `80`, and the simulator sends data to it using the Kubernetes DNS name configured in `API_URL`.

The default database connection used inside Kubernetes is:

```text
postgresql://admin:P%40ssw0rd123@db-service:5432/axiondb
```

For production, move database credentials to Kubernetes Secrets and use persistent storage for PostgreSQL.

## Troubleshooting

- **UI shows no data:** confirm the browser can reach the telemetry query service URL and that the UI `API_BASE` uses the correct protocol, host, and port.
- **Browser reports mixed content:** an HTTPS UI cannot call an HTTP API. Configure TLS through an Ingress or serve both through HTTPS.
- **API returns database errors:** check that PostgreSQL is ready, the schema has been applied, and `DATABASE_URL` points to the correct host.
- **No new telemetry:** inspect simulator logs and verify `API_URL` points to `ingestion-service.default.svc.cluster.local:80` in Kubernetes.
- **Check API directly:** open `/docs` or call `/devices` on the telemetry query service and verify that it returns JSON.

## Security Notes

The current manifests use development credentials and permissive CORS settings. Before production deployment:

- Store credentials in Kubernetes Secrets.
- Restrict CORS to the deployed UI origin.
- Add TLS termination and authentication at the API boundary.
- Add persistent volumes and backup procedures for PostgreSQL.

## License

No repository-wide license file is currently present. Add a license before distributing the project publicly.
