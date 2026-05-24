import type { ServiceTemplate } from "@singulary/shared";

export const serviceTemplates: ServiceTemplate[] = [
  {
    id: "postgres-16",
    kind: "database_postgres",
    name: "PostgreSQL 16",
    description: "Production-grade SQL database. Includes generated user, password, and database.",
    iconKey: "postgres",
    image: "postgres:16-alpine",
    defaultPort: 5432,
    defaultEnvKey: "DATABASE_URL",
    category: "database",
    connectionUriTemplate:
      "postgres://{{username}}:{{password}}@{{host}}:{{port}}/{{database}}",
    envTemplate: {
      POSTGRES_USER: "{{username}}",
      POSTGRES_PASSWORD: "{{password}}",
      POSTGRES_DB: "{{database}}"
    },
    fields: [
      {
        key: "database",
        label: "Database name",
        type: "string",
        defaultValue: "app",
        required: true,
        placeholder: "app"
      },
      {
        key: "username",
        label: "Username",
        type: "string",
        defaultValue: "app",
        required: true
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        secret: true,
        generated: true
      }
    ]
  },
  {
    id: "mysql-8",
    kind: "database_mysql",
    name: "MySQL 8",
    description: "Popular relational database. Generates root + app user credentials.",
    iconKey: "mysql",
    image: "mysql:8",
    defaultPort: 3306,
    defaultEnvKey: "DATABASE_URL",
    category: "database",
    connectionUriTemplate:
      "mysql://{{username}}:{{password}}@{{host}}:{{port}}/{{database}}",
    envTemplate: {
      MYSQL_USER: "{{username}}",
      MYSQL_PASSWORD: "{{password}}",
      MYSQL_DATABASE: "{{database}}",
      MYSQL_ROOT_PASSWORD: "{{rootPassword}}"
    },
    fields: [
      {
        key: "database",
        label: "Database name",
        type: "string",
        defaultValue: "app",
        required: true
      },
      {
        key: "username",
        label: "Username",
        type: "string",
        defaultValue: "app",
        required: true
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        secret: true,
        generated: true
      },
      {
        key: "rootPassword",
        label: "Root password",
        type: "password",
        secret: true,
        generated: true
      }
    ]
  },
  {
    id: "mariadb-11",
    kind: "database_mysql",
    name: "MariaDB 11",
    description: "Drop-in MySQL alternative. Generates root + app user credentials.",
    iconKey: "mariadb",
    image: "mariadb:11",
    defaultPort: 3306,
    defaultEnvKey: "DATABASE_URL",
    category: "database",
    connectionUriTemplate:
      "mysql://{{username}}:{{password}}@{{host}}:{{port}}/{{database}}",
    envTemplate: {
      MARIADB_USER: "{{username}}",
      MARIADB_PASSWORD: "{{password}}",
      MARIADB_DATABASE: "{{database}}",
      MARIADB_ROOT_PASSWORD: "{{rootPassword}}"
    },
    fields: [
      { key: "database", label: "Database name", type: "string", defaultValue: "app", required: true },
      { key: "username", label: "Username", type: "string", defaultValue: "app", required: true },
      { key: "password", label: "Password", type: "password", secret: true, generated: true },
      { key: "rootPassword", label: "Root password", type: "password", secret: true, generated: true }
    ]
  },
  {
    id: "mongo-7",
    kind: "database_mongo",
    name: "MongoDB 7",
    description: "Document database. Generates root credentials and a database name.",
    iconKey: "mongo",
    image: "mongo:7",
    defaultPort: 27017,
    defaultEnvKey: "MONGO_URL",
    category: "database",
    connectionUriTemplate:
      "mongodb://{{username}}:{{password}}@{{host}}:{{port}}/{{database}}?authSource=admin",
    envTemplate: {
      MONGO_INITDB_ROOT_USERNAME: "{{username}}",
      MONGO_INITDB_ROOT_PASSWORD: "{{password}}",
      MONGO_INITDB_DATABASE: "{{database}}"
    },
    fields: [
      { key: "database", label: "Database", type: "string", defaultValue: "app", required: true },
      { key: "username", label: "Root user", type: "string", defaultValue: "root", required: true },
      { key: "password", label: "Root password", type: "password", secret: true, generated: true }
    ]
  },
  {
    id: "redis-7",
    kind: "redis",
    name: "Redis 7",
    description: "In-memory cache and pub/sub. Optional password authentication.",
    iconKey: "redis",
    image: "redis:7-alpine",
    defaultPort: 6379,
    defaultEnvKey: "REDIS_URL",
    category: "cache",
    connectionUriTemplate: "redis://:{{password}}@{{host}}:{{port}}",
    envTemplate: {},
    fields: [
      {
        key: "password",
        label: "Password",
        type: "password",
        secret: true,
        generated: true
      }
    ]
  },
  {
    id: "minio",
    kind: "object_storage",
    name: "MinIO",
    description: "S3-compatible object storage. Generates root user and password.",
    iconKey: "minio",
    image: "minio/minio:latest",
    defaultPort: 9000,
    defaultEnvKey: "S3_ENDPOINT",
    category: "storage",
    connectionUriTemplate: "http://{{username}}:{{password}}@{{host}}:{{port}}",
    envTemplate: {
      MINIO_ROOT_USER: "{{username}}",
      MINIO_ROOT_PASSWORD: "{{password}}"
    },
    fields: [
      { key: "username", label: "Root user", type: "string", defaultValue: "minio", required: true },
      { key: "password", label: "Root password", type: "password", secret: true, generated: true }
    ]
  },
  {
    id: "rabbitmq-3",
    kind: "queue",
    name: "RabbitMQ 3",
    description: "AMQP message broker with management UI on port 15672.",
    iconKey: "rabbitmq",
    image: "rabbitmq:3-management-alpine",
    defaultPort: 5672,
    defaultEnvKey: "AMQP_URL",
    category: "queue",
    connectionUriTemplate: "amqp://{{username}}:{{password}}@{{host}}:{{port}}",
    envTemplate: {
      RABBITMQ_DEFAULT_USER: "{{username}}",
      RABBITMQ_DEFAULT_PASS: "{{password}}"
    },
    fields: [
      { key: "username", label: "User", type: "string", defaultValue: "app", required: true },
      { key: "password", label: "Password", type: "password", secret: true, generated: true }
    ]
  },
  {
    id: "meilisearch",
    kind: "search",
    name: "Meilisearch",
    description: "Fast full-text search engine with a single master key.",
    iconKey: "meilisearch",
    image: "getmeili/meilisearch:latest",
    defaultPort: 7700,
    defaultEnvKey: "MEILI_URL",
    category: "search",
    connectionUriTemplate: "http://{{host}}:{{port}}",
    envTemplate: {
      MEILI_MASTER_KEY: "{{masterKey}}"
    },
    fields: [
      { key: "masterKey", label: "Master key", type: "password", secret: true, generated: true }
    ]
  }
];

export function getServiceTemplate(id: string): ServiceTemplate | null {
  return serviceTemplates.find((template) => template.id === id) ?? null;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}
