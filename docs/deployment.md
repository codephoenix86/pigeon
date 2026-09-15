# Deploy Pigeon to Render

Pigeon includes a Render Blueprint that provisions the application and both of
its stateful dependencies from the repository:

```text
Public internet -> Pigeon web service -> private PostgreSQL
                                  \----> private Render Key Value
```

The web service runs the API, outbox publishers, and delivery worker in one
Node.js process, matching the architecture documented in the main README.

## Cost and region

The Blueprint deliberately selects Render's smallest paid web, PostgreSQL, and
Key Value plans. Review Render's current pricing before deployment. Paid
resources are used because pre-deploy commands are unavailable to free web
services and free Key Value instances do not provide persistence. Running the
queue without persistence would weaken Pigeon's delivery guarantees.

All three resources default to `oregon`. If another supported region is more
appropriate, change every `region` value in `render.yaml` before the first
deployment. Render does not allow a resource's region to be changed in place.

## Deploy

1. Commit and push `render.yaml` and the rest of Phase 9 to GitHub.
2. Open the [Render Dashboard](https://dashboard.render.com/), select **New >
   Blueprint**, and connect the Pigeon repository.
3. Review the three resources, their region, and their estimated monthly cost.
4. Apply the Blueprint.

Render injects private connection strings into `DATABASE_URL` and `REDIS_URL`.
Neither datastore accepts connections from the public internet. Each deployment
builds the production Docker image, applies committed Prisma migrations in the
pre-deploy step, and then starts the new application version. The pre-deploy
instance downloads the same pinned Prisma CLI version used by the project; that
CLI is not retained in the long-running application image. Render only directs
traffic to the new version after `/health` succeeds.

Automatic deployments wait for the linked commit's GitHub checks to pass.

## Verify the deployment

Copy the service's `onrender.com` URL from the Render Dashboard and check its
health endpoint:

```bash
curl -i https://YOUR-SERVICE.onrender.com/health
```

A successful deployment returns HTTP `200` and reports both `database` and
`redis` as `up`. Prometheus metrics are available at `/metrics`.

Provision the first client from the web service's Render Shell:

```bash
node dist/scripts/create-client.js
```

Save the displayed API key immediately. Only its hash is persisted, so the raw
key cannot be recovered later.

## Configuration and operations

Application tuning variables use the validated defaults documented in
`.env.example`. Add overrides in the Render Dashboard when necessary; do not
put credentials in `render.yaml`.

Before promoting a change, confirm that CI passed and inspect the pre-deploy log
to ensure migrations completed. Application rollback does not reverse database
migrations, so schema changes should remain backward-compatible with the
previous application version.

To stop incurring charges, delete the Blueprint-managed web service, Key Value
instance, and PostgreSQL instance in the Render Dashboard. Deleting either
datastore permanently removes its delivery or application data; take a backup
first if the data matters.
