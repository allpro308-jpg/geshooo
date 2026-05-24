# Services

Services represent shared infrastructure within a Workspace. Unlike normal projects, services are provisioned from a catalog and their connection details are automatically shared across the workspace.

## Supported Services
Singulary's Service Catalog allows you to easily provision real containers with generated credentials and ready-to-use connection URIs:

- **PostgreSQL 16**
- **MySQL 8 / MariaDB 11**
- **MongoDB 7**
- **Redis 7**
- **MinIO** (S3-compatible object storage)
- **RabbitMQ 3** (with management UI)
- **Meilisearch**

When a service is created, its connection string is injected as an environment variable (e.g., `DATABASE_URL`, `REDIS_URL`) into every project inside the same workspace.
