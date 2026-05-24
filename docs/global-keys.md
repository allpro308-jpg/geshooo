# Global Keys

Global keys are AI provider API credentials managed by the Instance Admin. They are made available across the entire Singulary instance, subject to rules and token quotas.

## Configuring Global Keys
1. As an `instance_admin`, go to the Admin Panel.
2. Navigate to **Providers**.
3. Add a new provider with its Base URL and API Key.
4. Singulary will automatically discover available models using the `/models` endpoint if the provider is OpenAI-compatible.

## Access Control
Global keys can be restricted using **Rules**. You can specify `ALL`, `ALLOW`, or `DENY` policies to determine which groups or workspaces can access specific models from the global pool.
