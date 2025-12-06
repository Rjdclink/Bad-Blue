.PHONY: help setup start stop restart logs clean shell db-shell status

.DEFAULT_GOAL := help

# Detect docker compose command
COMPOSE_CMD := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

help:
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  PANTHEON Development Commands"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  make setup       - Initial setup (90 sec)"
	@echo "  make start       - Start all services"
	@echo "  make stop        - Stop all services"
	@echo "  make restart     - Restart all services"
	@echo "  make logs        - View logs"
	@echo "  make shell       - Open app shell"
	@echo "  make db-shell    - Open database shell"
	@echo "  make status      - Show service status"
	@echo "  make clean       - Remove all containers"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

setup:
	@bash scripts/instant-setup.sh

start:
	@$(COMPOSE_CMD) up -d
	@echo "✅ Services started at http://localhost:5000"

stop:
	@$(COMPOSE_CMD) down
	@echo "✅ Services stopped"

restart:
	@$(COMPOSE_CMD) restart
	@echo "✅ Services restarted"

logs:
	@$(COMPOSE_CMD) logs -f

shell:
	@$(COMPOSE_CMD) exec app sh

db-shell:
	@$(COMPOSE_CMD) exec db psql -U postgres -d legalwhat

status:
	@$(COMPOSE_CMD) ps

clean:
	@$(COMPOSE_CMD) down -v
	@echo "✅ Cleaned up"
