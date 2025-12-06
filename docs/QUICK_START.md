# PANTHEON Quick Start Guide

Get PANTHEON running in under 2 minutes.

## Prerequisites

- Docker 20.10+ or Docker Desktop
- Git
- 4GB RAM minimum

## Installation

### One-Line Install

```bash
bash scripts/instant-setup.sh
```

**Time: 90 seconds**

### Using Make

```bash
make setup
```

## Verification

```bash
# Check services
make status

# View logs
make logs
```

## Access

- **Application:** http://localhost:5000
- **Database:** localhost:5432 (postgres/postgres)

## Common Commands

```bash
make start      # Start services
make stop       # Stop services
make logs       # View logs
make shell      # Open app shell
make db-shell   # Open database shell
make clean      # Remove everything
```

## Troubleshooting

### Services won't start

```bash
docker-compose logs
make clean
make setup
```

### Port already in use

Check what's using port 5000:
```bash
lsof -ti:5000
```

Stop the conflicting service or use docker-compose:
```bash
make stop
```

## Next Steps

1. Open http://localhost:5000
2. Create an account
3. Start using PANTHEON
