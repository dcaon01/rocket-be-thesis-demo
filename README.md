# Rocket - backend

Rocket is a web platform built at Keus S.r.l. to run a catalogue of proprietary SaaS products from one place: orders, licences, contracts, invoices and the metrics of every product. This repository holds its backend. It accompanies the master's thesis *Design and Development of a Scalable Web Platform for Proprietary Software Product Tracking and Management Using Enterprise-Level Frameworks and Cloud Architecture* (Damiano Caon, University of Padua, Department of Information Engineering).

The code is a copy of the one Keus runs, prepared for public consultation. It runs in demo mode, described below, and every change made for that purpose carries the comment `Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.`

Live demo: <https://d2c8lp2zkatd89.cloudfront.net> (the demo accounts are listed in the [frontend README](https://github.com/dcaon01/rocket-fe-thesis-demo#demo-accounts))

The other two parts of the platform:
- [rocket-fe-thesis-demo](https://github.com/dcaon01/rocket-fe-thesis-demo): the Angular interface;
- [rocket-infra-thesis-demo](https://github.com/dcaon01/rocket-infra-thesis-demo): the AWS infrastructure, in OpenTofu.

## Structure

An Nx monorepo with three applications, each deployed as its own AWS Lambda behind API Gateway:
- `apps/core`: the business domain in NestJS 11. Products, plans, companies, resellers, orders, tenants, users, contracts, invoices, metrics and the integration layer with the products, one folder per feature in `src/modules`. Data lives in DynamoDB through Dynamoose.
- `apps/cognito`: user management on Amazon Cognito, also in NestJS.
- `apps/render`: a small Python function that turns the HTML documents produced by the core into PDF with WeasyPrint.

Shared code lives in `libs`:
- `scoping`: the request scope that limits what a reseller or a product user can see;
- `rocket-shared`: a package built from the core's own DTOs and enums, so that the products use the same event types Rocket does.

Every feature module of the core is split in two. The eager module registers only the controller, and a lazy module, loaded on the first request that needs it, holds the service and the table binding. This keeps the Lambda cold start short. The OpenAPI documents come from the controllers' decorators and are served at `/swagger` and `/swagger-json`.

The products talk to Rocket through events. Rocket publishes on EventBridge what a product has to do, such as creating a tenant or suspending a user. The product answers on an SQS queue, which Rocket reads to confirm the operation.

## Demo mode

Set `INTEGRATIONS_ENABLED=false` on the core app to run Rocket with nothing outside AWS: no products (Nquadro, Genio, Pagai), no Stripe, Sibill, HubSpot, Intercom, Mixpanel or Sentry. When the variable is unset or `true`, Rocket behaves as usual.

With the integrations off:
- Rocket answers for the products. Instead of publishing on EventBridge, `DemoProductService` puts on the inbound queue the answer a product would send, so tenants and users get confirmed and the referent of the tenant accepts each new contract. For this the core Lambda needs `sqs:SendMessage` on the inbound queue.
- Nothing is charged. Contracts never wait for a payment, signed reseller contracts start without mandates, plans and reseller fees create no Stripe prices, and the charge of the 4th does nothing. The invoices Rocket issues itself (to resellers and finance companies) carry 22% VAT, stay open and get marked paid by hand. Sibill receives no electronic invoice.
- The metrics computed from Rocket's own data work as usual. Support, product adoption, technical errors and availability are read from their stored monthly records and never recalculated, since nothing would update them: those records are written once for the demo. The figures read live (HubSpot sales, Mixpanel KPI per tenant, Sentry issues and open alerts, Intercom brands, Sentry projects) come back empty.
- No email goes out: `MailService` only logs the ones it would send through SES. Cognito still sends its own invitations from its default address.
- The endpoints that need an integration (Stripe checkouts and mandates, Sibill documents, the webhooks, the HubSpot routes) answer with the `INTEGRATIONS_DISABLED` error code.

## Running it

The core needs real AWS resources to start: DynamoDB tables, SQS queues, an EventBridge bus, S3 buckets and a Cognito user pool. These come from the infrastructure repository, and `apps/core/.env.example` and `apps/cognito/.env.example` list the variables to point at them. With those in place:

```bash
npm ci
npm run dev:core      # port 3000
npm run dev:cognito   # port 3154
npm run lint
```

## Deployment

The `ci` workflow runs on every push to `main`. It finds the applications changed since the last deploy (the `last-deploy-dev` tag), builds them, uploads the packages to S3 and runs `tofu apply` from the infrastructure repository to point the Lambdas at the new packages. It signs in to AWS through GitHub's OIDC provider, so the repository holds no AWS key. The secrets it reads are the encryption key of the core and the token used to check out the infrastructure repository.

## Terms of use

This code is published with the consent of Keus S.r.l. for academic and evaluation purposes only, as a companion to the thesis above. All rights are reserved. The repository may be read, cloned and run to examine the work described in the thesis, but neither the code nor any part of it may be used, copied, modified or redistributed for commercial purposes. For any other use, contact the author through GitHub: https://github.com/dcaon01.
