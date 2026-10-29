# Rocket Backend Monorepo

This is a Nx monorepo containing two backend applications:

## 🚀 Applications

### 📦 Core App (`apps/core`)
- **Port**: 3000
- **Description**: Main rocket-core application
- **Technology**: NestJS + DynamoDB

### 🔐 Cognito App (`apps/cognito`) 
- **Port**: 3154
- **Description**: AWS Cognito user management service
- **Technology**: NestJS + AWS Cognito SDK

## 🛠️ Development Commands

### Build Applications
```bash
# Build all apps
npm run build

# Build specific app
npm run build:core
npm run build:cognito
```

### Start Development Servers
```bash
# Start core app (port 3000)
npm run dev:core

# Start cognito app (port 3154)  
npm run dev:cognito
```

### Production Start
```bash
# Start core app
npm run start:core

# Start cognito app
npm run start:cognito
```

### Testing
```bash
# Test all apps
npm run test

# Test specific app
npm run test:core
npm run test:cognito
```

### Linting
```bash
# Lint all apps
npm run lint

# Lint specific app
npm run lint:core
npm run lint:cognito
```

## 📊 Project Management

### View Dependency Graph
```bash
npm run graph
```

### View Project Structure
```bash
npx nx show projects
npx nx show project core
npx nx show project cognito
```

## ⚙️ Setup Requirements

### Environment Variables

#### For Cognito App
```env
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
COGNITO_USER_POOL_ID=your_pool_id
PORT=3154
```

#### For Core App
```env
PORT=3000
NODE_ENV=development
# Add other environment variables as needed
```

### Private Package Access
For accessing `@keus-dev/kosmo-lib-common-auth`, set:
```bash
export KEUS_GITHUB_TOKEN=your_github_token
```

## 🏗️ Architecture

```
rocket-be/
├── apps/
│   ├── core/           # Main application
│   └── cognito/        # User management service
├── libs/               # Shared libraries (future)
├── dist/              # Built applications
└── node_modules/      # Dependencies
```

## 🎭 Demo Mode

Set `INTEGRATIONS_ENABLED=false` on the core app to run Rocket with nothing outside AWS: no products (O2, Genio, Pagai), no Stripe, Sibill, HubSpot, Intercom, Mixpanel or Sentry. When the variable is unset or `true`, Rocket behaves as usual.

With the integrations off:
- Rocket answers for the products. Instead of publishing on EventBridge, `DemoProductService` puts on the inbound queue the answer a product would send, so tenants and users get confirmed and the referent of the tenant accepts each new contract. For this the core Lambda needs `sqs:SendMessage` on the inbound queue.
- Nothing is charged. Contracts never wait for a payment, signed reseller contracts start without mandates, plans and reseller fees create no Stripe prices, and the charge of the 4th does nothing. The invoices Rocket issues itself (to resellers and finance companies) carry 22% VAT, stay open and get marked paid by hand. Sibill receives no electronic invoice.
- The metrics computed from Rocket's own data work as usual. Support, product adoption, technical errors and availability are read from their stored monthly records and never recalculated, since nothing would update them: those records are written once for the demo. The figures read live (HubSpot sales, Mixpanel KPI per tenant, Sentry issues and open alerts, Intercom brands, Sentry projects) come back empty.
- No email goes out: `MailService` only logs the ones it would send through SES.
- The endpoints that need an integration (Stripe checkouts and mandates, Sibill documents, the webhooks, the HubSpot routes) answer with the `INTEGRATIONS_DISABLED` error code.

## 🚀 Getting Started

1. **Install dependencies**:
   ```bash
   export KEUS_GITHUB_TOKEN=your_token
   npm install
   ```

2. **Build applications**:
   ```bash
   npm run build
   ```

3. **Start development**:
   ```bash
   # Terminal 1: Start core
   npm run dev:core
   
   # Terminal 2: Start cognito
   npm run dev:cognito
   ```

## 📝 Features

- ✅ **Nx Monorepo** setup with optimal caching
- ✅ **TypeScript** configuration with path mapping  
- ✅ **ESLint** and **Prettier** for code quality
- ✅ **Jest** testing framework
- ✅ **Nodemon** for development hot reload
- ✅ **AWS SDK** integration for Cognito
- ✅ **NestJS** applications with proper configuration

## 🧪 Testing the Setup

Test that everything works:

```bash
# 1. Build both apps
npm run build:core && npm run build:cognito

# 2. Run tests  
npm run test:core && npm run test:cognito

# 3. Start development servers
npm run dev:core & npm run dev:cognito
```

## 📞 API Endpoints

### Core App (Port 3000)
- Health check and application endpoints

### Cognito App (Port 3154)
- `GET /kosmo-cognito/health` - Health check
- `PUT /kosmo-cognito/cognito/users/{tenant}` - Create user
- `GET /kosmo-cognito/cognito/users/{tenant}/list` - List users
- `GET /kosmo-cognito/cognito/users/{id}` - Get user
- And more user management endpoints...

Happy coding! 🚀